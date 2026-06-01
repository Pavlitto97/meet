/** Черга AI-генерацій (порт meeteditor/generations.php). Виконання — inline-async
 *  у main (OpenRouter I/O не блокує UI; sharp-деградація коротка). */
import fs from 'node:fs';
import { all, one, run, db, logActivity, toBuffer } from './db';
import { getSettings, getSetting } from './settings';
import { parseDataUrl, blobToDataUrl, avatarDataUrl } from './media';
import { callImage, extractImage, EmptyImageError } from './openrouter';
import { degradeBlob, camIsServer, autoResizeForAvatar } from './degrade';
import { DEFAULT_GEN_MODEL, DEFAULT_GEN_PROVIDER, DEFAULT_GEN_TIER } from './config';
import { promptFile } from './paths';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

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
    else inputUrl = row.participant_id ? avatarDataUrl(row.participant_id) : null;

    const maxAttempts = 5;
    let lastErr: any = null;
    let mime: string | null = null;
    let blob: Buffer | null = null;
    let usage: any = {};
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const resp = await callImage(apiKey, row.model, row.provider, row.service_tier, row.prompt, inputUrl);
        [mime, blob] = extractImage(resp);
        usage = resp.usage ?? {};
        lastErr = null;
        break;
      } catch (e: any) {
        if (e instanceof EmptyImageError) {
          lastErr = e;
          if (!e.retryable) throw e; // жорстка відмова — ретраї не допоможуть
          if (attempt < maxAttempts - 1) await sleep(1500);
        } else {
          throw e;
        }
      }
    }
    if (lastErr && blob === null) throw lastErr;

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
    logActivity('generation.done', `#${genId} cost=${cost ?? ''}${degPct !== null ? ` deg=${degPct}%` : ''}`);
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
  const pid = body.participant_id ?? null;
  let prompt = String(body.prompt ?? '').trim();
  if (prompt === '') prompt = fs.existsSync(promptFile()) ? fs.readFileSync(promptFile(), 'utf8').trim() : '';
  if (prompt === '') return { error: 'prompt порожній', _status: 400 };
  const s = getSettings(true);
  if (!s.openrouter_api_key) return { error: 'OpenRouter API key не задано', _status: 400 };
  const model = body.model || s.gen_model || DEFAULT_GEN_MODEL;
  const provider = body.provider || s.gen_provider || DEFAULT_GEN_PROVIDER;
  const tier = body.service_tier || s.gen_tier || DEFAULT_GEN_TIER;

  let inBlob: Buffer | null = null;
  let inMime: string | null = null;
  if (pid) {
    const url = avatarDataUrl(pid);
    if (url) {
      try {
        [inMime, inBlob] = parseDataUrl(url);
      } catch {
        inBlob = null;
        inMime = null;
      }
    }
  }
  const r = run(
    'INSERT INTO generations(participant_id, prompt, model, provider, service_tier, input_image, input_mime) VALUES(?,?,?,?,?,?,?)',
    [pid, prompt, model, provider, tier, inBlob, inMime]
  );
  const genId = r.lastInsertRowid;
  logActivity('generation.start', `#${genId} pid=${pid}`);
  void runGeneration(genId); // фон у main
  return { id: genId };
}

export function listGenerations(participant: string | null, status: string | null): any[] {
  let sql =
    'SELECT g.id, g.participant_id, g.prompt, g.model, g.provider, g.service_tier, ' +
    'g.status, g.error, g.image IS NOT NULL AS has_image, g.image_mime, ' +
    'g.input_image IS NOT NULL AS has_input, ' +
    'g.cost_usd, g.prompt_tokens, g.output_tokens, g.created_at, g.finished_at, g.degrade_pct, ' +
    'COALESCE(p.custom_name, p.original_name) AS participant_name ' +
    'FROM generations g LEFT JOIN participants p ON p.device_id = g.participant_id WHERE 1=1';
  const args: unknown[] = [];
  if (participant) {
    sql += ' AND g.participant_id = ?';
    args.push(participant);
  }
  if (status) {
    sql += ' AND g.status = ?';
    args.push(status);
  }
  sql += ' ORDER BY g.participant_id, g.id DESC LIMIT 200';
  return all(sql, args);
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

export async function approveGeneration(gid: number, which: 'start' | 'end' = 'start'): Promise<Record<string, any>> {
  const blobCol = which === 'end' ? 'avatar_end' : 'avatar';
  const mimeCol = which === 'end' ? 'avatar_end_mime' : 'avatar_mime';
  const row = one('SELECT participant_id, image, image_mime, status FROM generations WHERE id = ?', [gid]);
  const img = toBuffer(row?.image);
  if (!row) return { error: 'not found', _status: 404 };
  if (row.status !== 'done' || !img) return { error: 'генерація ще не готова', _status: 400 };
  const pid = row.participant_id;
  if (!pid) return { error: 'генерація не привʼязана до учасника', _status: 400 };
  // Зменшуємо під плитку Meet (settings gen_resize*) — поза транзакцією (sharp async).
  const [avBlob, avMime] = await autoResizeForAvatar(img, row.image_mime);
  const con = db();
  con.exec('BEGIN');
  try {
    const r = run(`UPDATE participants SET ${blobCol}=?, ${mimeCol}=?, updated_at=CURRENT_TIMESTAMP WHERE device_id=?`, [avBlob, avMime, pid]);
    if (r.changes === 0) {
      con.exec('ROLLBACK');
      return { error: 'учасника не знайдено', _status: 404 };
    }
    run('DELETE FROM generations WHERE id = ?', [gid]);
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  logActivity('generation.approve', `#${gid} → ${pid} (${which})`);
  return { ok: true };
}

export function regenerate(gid: number): Record<string, any> {
  const row = one(
    'SELECT participant_id, prompt, model, provider, service_tier, input_image, input_mime FROM generations WHERE id = ?',
    [gid]
  );
  if (!row) return { error: 'not found', _status: 404 };
  const r = run(
    'INSERT INTO generations(participant_id, prompt, model, provider, service_tier, input_image, input_mime) VALUES(?,?,?,?,?,?,?)',
    [row.participant_id, row.prompt, row.model, row.provider, row.service_tier, toBuffer(row.input_image), row.input_mime]
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
