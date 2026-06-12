/** Черга AI-генерацій. Вхід генерації — ЗАВЖДИ source-зображення учасника
 *  (оригінал, завантажений користувачем); знімок входу лягає в input_image.
 *  Результат — 16:9-колаж «початок|кінець» (promt.md); approve ріже його навпіл
 *  і застосовує до учасника, НЕ видаляючи генерацію (історія для порівняння). */
import fs from 'node:fs';
import sharp from 'sharp';
import { all, one, run, db, logActivity, toBuffer } from './db';
import { getSettings, getSetting } from './settings';
import { blobToDataUrl, participantImageDataUrl, parseDataUrl } from './media';
import { callImage, extractImage, EmptyImageError, OpenRouterHttpError } from './openrouter';
import { degradeBlob, camIsServer, autoResizeForAvatar } from './degrade';
import { DEFAULT_GEN_MODEL, DEFAULT_GEN_PROVIDER, DEFAULT_GEN_TIER } from './config';
import { promptFile } from './paths';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

interface Routing {
  provider: string;
  tier: string;
  allowFallbacks: boolean;
}

/**
 * Послідовність маршрутизацій OpenRouter: спершу як налаштовано (напр. дешевий
 * flex на одному провайдері), а на rate-limit/несумісності тарифу — надійні
 * фолбеки. flex живе лише на одному провайдері й часто rate-limited, тому
 * фолбеки переходять на тариф 'default' з дозволеним перемиканням провайдера.
 * Дублікати прибираються.
 */
function routingChain(provider: string, tier: string): Routing[] {
  const out: Routing[] = [];
  const seen = new Set<string>();
  const add = (p: string, t: string, fb: boolean) => {
    const key = `${p}|${t}|${fb}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ provider: p, tier: t, allowFallbacks: fb });
    }
  };
  add(provider, tier, false); // 1) точно як налаштовано (дешево, якщо доступно)
  if (provider) add(provider, 'default', true); // 2) той самий провайдер, default-тариф + дозволити OR-фолбек
  add('', 'default', true); // 3) будь-який провайдер: OpenRouter сам обере найдоступніший
  return out;
}

/** Авто-деградація щойно згенерованого фото. [bytes, mime, pct|null]. */
export async function autoDegradeGeneration(blob: Buffer, mime: string): Promise<[Buffer, string, number | null]> {
  const s = getSettings(false);
  const on = String(s.gen_degrade ?? '1');
  if (on === '' || on === '0') return [blob, mime, null];
  const method = String(s.gen_degrade_method ?? 'gd-jpeg');
  if (!camIsServer(method)) return [blob, mime, null];
  let min = Math.max(0, Math.min(100, parseInt(String(s.gen_degrade_min ?? '60'), 10) || 0));
  let max = Math.max(0, Math.min(100, parseInt(String(s.gen_degrade_max ?? '100'), 10) || 0));
  if (max < min) [min, max] = [max, min];
  const pct = max > min ? randInt(min, max) : min;
  if (pct <= 0) return [blob, mime, null];
  const [deg, degMime] = await degradeBlob(blob, mime, method, pct / 100);
  if (deg === blob) return [blob, mime, null]; // не зміг декодувати — лишаємо як є
  return [deg, degMime, pct];
}

/** Виконує генерацію (фоном у main). Оновлює рядок generations. */
export async function runGeneration(genId: number): Promise<void> {
  try {
    const row = one(
      'SELECT id, participant_id, prompt, model, provider, service_tier, input_image, input_mime FROM generations WHERE id = ?',
      [genId]
    );
    if (!row) return;
    const apiKey = getSetting('openrouter_api_key');
    if (apiKey === '') throw new Error('OpenRouter API key не задано. Введи його у налаштуваннях.');

    let inputUrl: string | null;
    const inImg = toBuffer(row.input_image);
    if (inImg && row.input_mime) inputUrl = blobToDataUrl(row.input_mime, inImg);
    else inputUrl = row.participant_id ? participantImageDataUrl(Number(row.participant_id), 'source') : null;

    // Маршрутизації пробуємо по черзі; всередині кожної — кілька спроб на
    // транзієнтні збої. На rate-limit (429) одразу переходимо до наступної
    // маршрутизації (інший провайдер/тариф), а не довбимо ту саму квоту.
    const routings = routingChain(row.provider, row.service_tier);
    const innerAttempts = 3;
    let lastErr: any = null;
    let mime: string | null = null;
    let blob: Buffer | null = null;
    let usage: any = {};
    let usedRouting: Routing | null = null;

    outer: for (const routing of routings) {
      for (let attempt = 0; attempt < innerAttempts; attempt++) {
        try {
          const resp = await callImage(apiKey, row.model, routing.provider, routing.tier, row.prompt, inputUrl, routing.allowFallbacks);
          [mime, blob] = extractImage(resp);
          usage = resp.usage ?? {};
          usedRouting = routing;
          lastErr = null;
          break outer;
        } catch (e: any) {
          lastErr = e;
          if (e instanceof EmptyImageError) {
            if (!e.retryable) throw e; // жорстка відмова моделі — нічого не врятує
            await sleep(1500); // транзієнтний порожній кадр — ще спроба в тій же маршрутизації
          } else if (e instanceof OpenRouterHttpError) {
            // 401/403 — ключ/доступ: фолбек не допоможе.
            if (e.httpCode === 401 || e.httpCode === 403) throw e;
            // 429/5xx/тариф-400 — не марнуємо спроби на ту саму квоту,
            // одразу наступна маршрутизація (інший провайдер/тариф).
            await sleep(e.httpCode === 429 ? 2000 : 1000);
            break;
          } else {
            // Мережева помилка/таймаут — короткий бекоф і повтор у тій же маршрутизації.
            await sleep(1500);
          }
        }
      }
    }
    if (blob === null) throw lastErr ?? new Error('генерація не вдалась');

    let degPct: number | null = null;
    if (blob !== null && mime !== null) {
      [blob, mime, degPct] = await autoDegradeGeneration(blob, mime);
    }
    const cost = usage.cost ?? null;
    const ptok = usage.prompt_tokens ?? null;
    const otok = usage.completion_tokens ?? usage.output_tokens ?? null;
    run(
      "UPDATE generations SET status='done', image=?, image_mime=?, degrade_pct=?, cost_usd=?, " +
        'prompt_tokens=?, output_tokens=?, finished_at=CURRENT_TIMESTAMP WHERE id=?',
      [blob, mime, degPct, cost, ptok, otok, genId]
    );
    const via = usedRouting ? ` via=${usedRouting.provider || 'auto'}/${usedRouting.tier}` : '';
    logActivity('generation.done', `#${genId} cost=${cost ?? ''}${degPct !== null ? ` deg=${degPct}%` : ''}${via}`);
  } catch (e: any) {
    const msg = `${e?.name || 'Error'}: ${e?.message || String(e)}`.trim();
    try {
      run("UPDATE generations SET status='error', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?", [msg, genId]);
    } catch {
      /* ignore */
    }
    logActivity('generation.error', `#${genId} ${msg.slice(0, 120)}`);
  }
}

export function createGeneration(body: Record<string, any>): Record<string, any> {
  const pid = body.participant_id != null ? parseInt(String(body.participant_id), 10) : null;
  if (!pid || !Number.isFinite(pid)) return { error: 'participant_id обовʼязковий', _status: 400 };
  const participant = one('SELECT id, source, source_mime FROM participants WHERE id = ?', [pid]);
  if (!participant) return { error: 'учасника не знайдено', _status: 404 };
  // Вхід — ТІЛЬКИ оригінальне (source) фото. Без нього генерація не має сенсу.
  const inBlob = toBuffer(participant.source);
  const inMime = participant.source_mime as string | null;
  if (!inBlob || !inMime) {
    return { error: 'Спочатку завантаж оригінальне фото учасника — генерація йде з нього', _status: 400 };
  }
  let prompt = String(body.prompt ?? '').trim();
  if (prompt === '') prompt = fs.existsSync(promptFile()) ? fs.readFileSync(promptFile(), 'utf8').trim() : '';
  if (prompt === '') return { error: 'prompt порожній', _status: 400 };
  const s = getSettings(true);
  if (!s.openrouter_api_key) return { error: 'OpenRouter API key не задано', _status: 400 };
  const model = body.model || s.gen_model || DEFAULT_GEN_MODEL;
  const provider = body.provider || s.gen_provider || DEFAULT_GEN_PROVIDER;
  const tier = body.service_tier || s.gen_tier || DEFAULT_GEN_TIER;

  const r = run(
    'INSERT INTO generations(participant_id, prompt, model, provider, service_tier, input_image, input_mime) VALUES(?,?,?,?,?,?,?)',
    // String(pid): JS-число біндиться як REAL і в TEXT-колонці осідає "1.0".
    [String(pid), prompt, model, provider, tier, inBlob, inMime]
  );
  const genId = r.lastInsertRowid;
  logActivity('generation.start', `#${genId} pid=${pid}`);
  void runGeneration(genId); // фон у main
  return { id: genId };
}

export function listGenerations(participant: string | null, status: string | null, group: string | null): any[] {
  let sql =
    // CAST: participant_id історично TEXT — назовні віддаємо число (битий/legacy → 0 → falsy).
    'SELECT g.id, CAST(g.participant_id AS INTEGER) AS participant_id, g.prompt, g.model, g.provider, g.service_tier, ' +
    'g.status, g.error, g.image IS NOT NULL AS has_image, g.image_mime, ' +
    'g.input_image IS NOT NULL AS has_input, g.image_orig IS NOT NULL AS retouched, ' +
    'g.cost_usd, g.prompt_tokens, g.output_tokens, g.created_at, g.finished_at, g.degrade_pct, g.approved_at, ' +
    'p.custom_name AS p_custom, p.original_name AS p_orig, p.user_added AS p_user_added, ' +
    'p.group_id AS group_id, gr.name AS group_name ' +
    'FROM generations g ' +
    'LEFT JOIN participants p ON p.id = g.participant_id ' +
    'LEFT JOIN groups gr ON gr.id = p.group_id WHERE 1=1';
  const args: unknown[] = [];
  if (participant) {
    sql += ' AND g.participant_id = ?';
    // String(): колонка TEXT, а число біндиться як REAL ('5' ≠ '5.0').
    args.push(String(parseInt(participant, 10)));
  }
  if (group) {
    sql += ' AND p.group_id = ?';
    args.push(parseInt(group, 10));
  }
  if (status) {
    sql += ' AND g.status = ?';
    args.push(status);
  }
  sql += ' ORDER BY g.id DESC LIMIT 200';
  // original_name шаблонних слотів — latin1-простір (байти шаблону) → декодуємо у
  // читабельний UTF-8; у user_added він уже звичайний UTF-8-рядок (не чіпаємо).
  return all(sql, args).map(({ p_custom, p_orig, p_user_added, ...r }) => ({
    ...r,
    participant_name:
      p_custom ??
      (p_orig != null
        ? p_user_added
          ? String(p_orig)
          : Buffer.from(String(p_orig), 'latin1').toString('utf8')
        : null),
  }));
}

export function generationImage(gid: number): [Buffer, string] | null {
  const row = one('SELECT image, image_mime FROM generations WHERE id = ?', [gid]);
  const blob = toBuffer(row?.image);
  if (!row || !blob) return null;
  return [blob, row.image_mime];
}

export function generationInput(gid: number): [Buffer, string] | null {
  const row = one('SELECT input_image, input_mime FROM generations WHERE id = ?', [gid]);
  const blob = toBuffer(row?.input_image);
  if (!row || !blob) return null;
  return [blob, row.input_mime || 'image/jpeg'];
}

/** Ріже колаж навпіл: широкий → ліво/право, високий (h/w>1.3) → верх/низ. */
async function splitCollage(blob: Buffer): Promise<{ start: Buffer; end: Buffer } | null> {
  try {
    const meta = await sharp(blob).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 2 || h < 2) return null;
    const vertical = h / w > 1.3;
    const half = vertical
      ? { width: w, height: Math.floor(h / 2) }
      : { width: Math.floor(w / 2), height: h };
    const start = await sharp(blob).extract({ left: 0, top: 0, ...half }).png().toBuffer();
    const end = await sharp(blob)
      .extract({ left: vertical ? 0 : w - half.width, top: vertical ? h - half.height : 0, ...half })
      .png()
      .toBuffer();
    return { start, end };
  } catch {
    return null;
  }
}

/**
 * Застосовує генерацію до учасника: ріже колаж на «початок»/«кінець»,
 * зменшує під плитку і пише в avatar/avatar_end. side: both|start|end.
 * Генерація лишається в історії з approved_at (єдина «застосована» на учасника).
 */
export async function approveGeneration(gid: number, side: 'both' | 'start' | 'end' = 'both'): Promise<Record<string, any>> {
  const row = one('SELECT participant_id, image, image_mime, status FROM generations WHERE id = ?', [gid]);
  const img = toBuffer(row?.image);
  if (!row) return { error: 'not found', _status: 404 };
  if (row.status !== 'done' || !img) return { error: 'генерація ще не готова', _status: 400 };
  const pid = row.participant_id;
  if (!pid) return { error: 'генерація не привʼязана до учасника', _status: 400 };

  const halves = await splitCollage(img);
  if (!halves) return { error: 'не вдалося розрізати колаж', _status: 500 };
  // Зменшуємо під плитку Meet (settings gen_resize*) — поза транзакцією (sharp async).
  const updates: Array<[string, string, Buffer, string]> = [];
  if (side === 'both' || side === 'start') {
    const [b, m] = await autoResizeForAvatar(halves.start, 'image/png');
    updates.push(['avatar', 'avatar_mime', b, m]);
  }
  if (side === 'both' || side === 'end') {
    const [b, m] = await autoResizeForAvatar(halves.end, 'image/png');
    updates.push(['avatar_end', 'avatar_end_mime', b, m]);
  }

  const con = db();
  con.exec('BEGIN');
  try {
    for (const [blobCol, mimeCol, blob, mime] of updates) {
      const r = run(`UPDATE participants SET ${blobCol}=?, ${mimeCol}=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [blob, mime, pid]);
      if (r.changes === 0) {
        con.exec('ROLLBACK');
        return { error: 'учасника не знайдено', _status: 404 };
      }
    }
    // Історію не видаляємо: позначаємо застосовану, знімаємо позначку з решти.
    run('UPDATE generations SET approved_at=NULL WHERE participant_id=? AND id != ?', [pid, gid]);
    run('UPDATE generations SET approved_at=CURRENT_TIMESTAMP WHERE id=?', [gid]);
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  logActivity('generation.approve', `#${gid} → учасник #${pid} (${side})`);
  return { ok: true };
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Ручний кроп: вирізає область колажа і ставить її аватаркою «початок» або
 * «кінець» (для зрізання білих рамок і точного кадрування). Координати — у
 * пікселях оригінального зображення; клемпляться у межі. Генерація лишається
 * в історії і позначається застосованою (approved_at).
 */
export async function cropGeneration(gid: number, which: 'start' | 'end', rect: CropRect): Promise<Record<string, any>> {
  const row = one('SELECT participant_id, image, image_mime, status FROM generations WHERE id = ?', [gid]);
  const img = toBuffer(row?.image);
  if (!row) return { error: 'not found', _status: 404 };
  if (row.status !== 'done' || !img) return { error: 'генерація ще не готова', _status: 400 };
  const pid = row.participant_id;
  if (!pid) return { error: 'генерація не привʼязана до учасника', _status: 400 };

  let W = 0;
  let H = 0;
  try {
    const meta = await sharp(img).metadata();
    W = meta.width ?? 0;
    H = meta.height ?? 0;
  } catch {
    return { error: 'не вдалося прочитати зображення генерації', _status: 500 };
  }
  if (W < 2 || H < 2) return { error: 'бите зображення генерації', _status: 500 };

  const x = Math.max(0, Math.min(Math.round(rect.x), W - 1));
  const y = Math.max(0, Math.min(Math.round(rect.y), H - 1));
  const w = Math.max(1, Math.min(Math.round(rect.width), W - x));
  const h = Math.max(1, Math.min(Math.round(rect.height), H - y));
  if (w < 8 || h < 8) return { error: 'занадто мала область (мінімум 8×8 px)', _status: 400 };

  let cropped: Buffer;
  try {
    cropped = await sharp(img).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
  } catch {
    return { error: 'не вдалося обрізати зображення', _status: 500 };
  }
  const [avBlob, avMime] = await autoResizeForAvatar(cropped, 'image/png');

  const blobCol = which === 'end' ? 'avatar_end' : 'avatar';
  const mimeCol = which === 'end' ? 'avatar_end_mime' : 'avatar_mime';
  const con = db();
  con.exec('BEGIN');
  try {
    const r = run(`UPDATE participants SET ${blobCol}=?, ${mimeCol}=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [avBlob, avMime, pid]);
    if (r.changes === 0) {
      con.exec('ROLLBACK');
      return { error: 'учасника не знайдено', _status: 404 };
    }
    run('UPDATE generations SET approved_at=NULL WHERE participant_id=? AND id != ?', [pid, gid]);
    run('UPDATE generations SET approved_at=CURRENT_TIMESTAMP WHERE id=?', [gid]);
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  logActivity('generation.crop', `#${gid} → учасник #${pid} (${which}, ${w}x${h}@${x},${y})`);
  return { ok: true, x, y, width: w, height: h };
}

/**
 * Ретуш: рендерер малює блюр/пікселізацію/замазування на canvas і шле повний
 * відредагований кадр data:-URL-ом. image перезаписується; оригінал генерації
 * відкладається в image_orig при ПЕРШІЙ ретуші (повторні ретуші його не псують),
 * щоб «Відновити оригінал» завжди повертав чистий результат моделі.
 */
export async function retouchGeneration(gid: number, imageDataUrl: unknown): Promise<Record<string, any>> {
  const row = one('SELECT id, status, image, image_mime, image_orig FROM generations WHERE id = ?', [gid]);
  const img = toBuffer(row?.image);
  if (!row) return { error: 'not found', _status: 404 };
  if (row.status !== 'done' || !img) return { error: 'генерація ще не готова', _status: 400 };
  if (typeof imageDataUrl !== 'string' || imageDataUrl === '') {
    return { error: 'image_data_url обовʼязковий', _status: 400 };
  }
  let mime: string;
  let blob: Buffer;
  try {
    [mime, blob] = parseDataUrl(imageDataUrl);
  } catch {
    return { error: 'bad data URL for image_data_url', _status: 400 };
  }
  if (!mime.startsWith('image/')) return { error: 'очікувалось зображення', _status: 400 };
  // Декодуємо через sharp: і валідація байтів, і захист від підробленого mime.
  try {
    const meta = await sharp(blob).metadata();
    if ((meta.width ?? 0) < 8 || (meta.height ?? 0) < 8) return { error: 'занадто мале зображення', _status: 400 };
  } catch {
    return { error: 'не вдалося прочитати зображення ретуші', _status: 400 };
  }
  const firstRetouch = toBuffer(row.image_orig) === null;
  if (firstRetouch) {
    run('UPDATE generations SET image_orig = image, image_orig_mime = image_mime WHERE id = ?', [gid]);
  }
  run('UPDATE generations SET image = ?, image_mime = ? WHERE id = ?', [blob, mime, gid]);
  logActivity('generation.retouch', `#${gid} ${mime} ${blob.length} байт${firstRetouch ? ' (оригінал збережено)' : ''}`);
  return { ok: true, retouched: 1 };
}

/** Повертає оригінальний (до ретуші) кадр генерації. */
export function restoreGenerationImage(gid: number): Record<string, any> {
  const row = one('SELECT id, image_orig FROM generations WHERE id = ?', [gid]);
  if (!row) return { error: 'not found', _status: 404 };
  if (toBuffer(row.image_orig) === null) return { error: 'оригінал не збережено — генерацію не ретушували', _status: 400 };
  run(
    'UPDATE generations SET image = image_orig, image_mime = image_orig_mime, image_orig = NULL, image_orig_mime = NULL WHERE id = ?',
    [gid]
  );
  logActivity('generation.retouch_restore', `#${gid}`);
  return { ok: true, retouched: 0 };
}

/**
 * Воркер генерації живе в main-процесі, тож pending на старті = мертвий
 * (перерваний перезапуском). Позначаємо помилкою, щоб картки не висіли вічно.
 */
export function failOrphanedGenerations(): void {
  const r = run("UPDATE generations SET status='error', error='Перервано перезапуском додатку — натисни «Повторити»', finished_at=CURRENT_TIMESTAMP WHERE status='pending'");
  if (r.changes > 0) logActivity('generation.orphaned', `${r.changes} шт`);
}

/** Повтор генерації: ті самі параметри, але вхід — АКТУАЛЬНИЙ source учасника. */
export function regenerate(gid: number): Record<string, any> {
  const row = one(
    'SELECT participant_id, prompt, model, provider, service_tier, input_image, input_mime FROM generations WHERE id = ?',
    [gid]
  );
  if (!row) return { error: 'not found', _status: 404 };
  let inBlob: Buffer | null = null;
  let inMime: string | null = null;
  if (row.participant_id) {
    const p = one('SELECT source, source_mime FROM participants WHERE id = ?', [Number(row.participant_id)]);
    inBlob = toBuffer(p?.source);
    inMime = (p?.source_mime as string | null) ?? null;
  }
  if (!inBlob || !inMime) {
    // Фолбек: source стерли — повторюємо зі знімком входу оригінальної генерації.
    inBlob = toBuffer(row.input_image);
    inMime = row.input_mime;
  }
  const r = run(
    'INSERT INTO generations(participant_id, prompt, model, provider, service_tier, input_image, input_mime) VALUES(?,?,?,?,?,?,?)',
    [row.participant_id, row.prompt, row.model, row.provider, row.service_tier, inBlob, inMime]
  );
  const newId = r.lastInsertRowid;
  logActivity('generation.regenerate', `#${gid} → #${newId}`);
  void runGeneration(newId);
  return { id: newId };
}

export function deleteGeneration(gid: number): Record<string, any> {
  run('DELETE FROM generations WHERE id = ?', [gid]);
  return { ok: true };
}

export function bulkDeleteGenerations(scope: string): Record<string, any> {
  let r: { changes: number };
  if (scope === 'all') {
    r = run('DELETE FROM generations');
  } else if (['error', 'done', 'pending'].includes(scope)) {
    r = run('DELETE FROM generations WHERE status = ?', [scope]);
  } else {
    return { error: 'scope має бути error|done|pending|all', _status: 400 };
  }
  logActivity('generation.bulk_delete', `${scope}: ${r.changes}`);
  return { ok: true, deleted: r.changes };
}
