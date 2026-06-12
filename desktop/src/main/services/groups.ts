/** Групи учасників: CRUD + активна група (її учасники йдуть у рендер і скріни)
 *  + слайд презентації групи (зображення для відео-області шаблону). */
import sharp from 'sharp';
import { all, one, run, db, logActivity, seedGroupParticipants, toBuffer } from './db';
import { parseDataUrl } from './media';
import { getSetting } from './settings';

/** id активної групи. Самолікується, якщо setting вказує на неіснуючу групу. */
export function activeGroupId(): number {
  const raw = parseInt(getSetting('active_group_id'), 10);
  if (Number.isFinite(raw) && one('SELECT 1 AS x FROM groups WHERE id = ?', [raw])) return raw;
  const first = one('SELECT id FROM groups ORDER BY id LIMIT 1');
  const fallback = Number(first?.id ?? 1);
  run("INSERT INTO settings(key, value) VALUES('active_group_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [
    String(fallback),
  ]);
  return fallback;
}

/** Перевірений id групи з query/body; null → активна група. */
export function resolveGroupId(raw: unknown): number | { error: string; _status: number } {
  if (raw === null || raw === undefined || raw === '') return activeGroupId();
  const id = parseInt(String(raw), 10);
  if (!Number.isFinite(id) || !one('SELECT 1 AS x FROM groups WHERE id = ?', [id])) {
    return { error: 'групу не знайдено', _status: 404 };
  }
  return id;
}

export function listGroups(): any[] {
  const active = activeGroupId();
  const rows = all(`
    SELECT g.id, g.name, g.created_at,
      g.slide IS NOT NULL AS has_slide,
      COUNT(p.id) AS participants,
      SUM(CASE WHEN p.skipped = 0 THEN 1 ELSE 0 END) AS editable,
      SUM(CASE WHEN p.source IS NOT NULL THEN 1 ELSE 0 END) AS with_source,
      SUM(CASE WHEN p.avatar IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar,
      SUM(CASE WHEN p.avatar_end IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar_end
    FROM groups g LEFT JOIN participants p ON p.group_id = g.id AND p.deleted = 0
    GROUP BY g.id ORDER BY g.id
  `);
  const gens: Record<number, number> = {};
  for (const r of all(
    'SELECT p.group_id AS gid, COUNT(*) AS n FROM generations g JOIN participants p ON p.id = g.participant_id GROUP BY p.group_id'
  )) {
    gens[r.gid] = Number(r.n);
  }
  return rows.map((r) => ({ ...r, generations: gens[r.id] ?? 0, active: Number(r.id) === active ? 1 : 0 }));
}

export function createGroup(body: Record<string, any>): Record<string, any> {
  const name = String(body.name ?? '').trim();
  if (name === '') return { error: 'назва групи порожня', _status: 400 };
  const r = run('INSERT INTO groups(name) VALUES(?)', [name]);
  seedGroupParticipants(r.lastInsertRowid);
  logActivity('group.create', `#${r.lastInsertRowid} ${name}`);
  return { id: r.lastInsertRowid, name };
}

export function renameGroup(id: number, body: Record<string, any>): Record<string, any> {
  const name = String(body.name ?? '').trim();
  if (name === '') return { error: 'назва групи порожня', _status: 400 };
  const r = run('UPDATE groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, id]);
  if (r.changes === 0) return { error: 'групу не знайдено', _status: 404 };
  logActivity('group.rename', `#${id} → ${name}`);
  return { ok: true };
}

export function deleteGroup(id: number): Record<string, any> {
  if (!one('SELECT 1 AS x FROM groups WHERE id = ?', [id])) return { error: 'групу не знайдено', _status: 404 };
  const total = Number(one('SELECT COUNT(*) AS n FROM groups')?.n ?? 0);
  if (total <= 1) return { error: 'не можна видалити останню групу', _status: 400 };
  const con = db();
  con.exec('BEGIN');
  try {
    run('DELETE FROM generations WHERE participant_id IN (SELECT id FROM participants WHERE group_id = ?)', [id]);
    run('DELETE FROM participants WHERE group_id = ?', [id]);
    run('DELETE FROM groups WHERE id = ?', [id]);
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  // Якщо видалили активну — activeGroupId() самолікується на першу наявну.
  activeGroupId();
  logActivity('group.delete', `#${id}`);
  return { ok: true };
}

// ─── Слайд презентації групи ───────────────────────────────────────────────────
// Відео-область шаблону ≈ 1573×856 — більші зображення зменшуємо (contain, без
// апскейлу), щоб data:-URL у рендері не роздувався мегабайтами без потреби.
const SLIDE_MAX_W = 1920;
const SLIDE_MAX_H = 1080;

/** [Buffer, mime] слайда групи або null. */
export function groupSlide(groupId: number): [Buffer, string] | null {
  const row = one('SELECT slide, slide_mime FROM groups WHERE id = ?', [groupId]);
  const blob = toBuffer(row?.slide);
  if (!row || !blob || blob.length === 0 || !row.slide_mime) return null;
  return [blob, row.slide_mime];
}

/**
 * Якщо як слайд завантажили СКРІНШОТ УСЬОГО МІТА (а не картинку слайда) — у
 * рендері в області презентації з'являється «міт у міті» з другою панеллю
 * «Люди». Розпізнаємо цей випадок: світла сторінка документа на темному UI =
 * найбільша зв'язна яскрава область, суцільна (прямокутна) і помітно менша за
 * кадр, довкола — темно. Тоді повертаємо bbox для обрізання; інакше null
 * (звичайний слайд — не чіпаємо).
 */
export async function detectPresentationCrop(
  blob: Buffer
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const SCAN_W = 320;
  const meta = await sharp(blob).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W < 200 || H < 200) return null;
  const scanH = Math.max(2, Math.round((H / W) * SCAN_W));
  const { data } = await sharp(blob).resize(SCAN_W, scanH, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const N = SCAN_W * scanH;
  const bright = (i: number) => data[i] >= 200;

  // Найбільша зв'язна яскрава компонента (BFS, 4-зв'язність).
  const seen = new Uint8Array(N);
  const qx = new Int32Array(N);
  const qy = new Int32Array(N);
  let best = { size: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  for (let y0 = 0; y0 < scanH; y0++) {
    for (let x0 = 0; x0 < SCAN_W; x0++) {
      const i0 = y0 * SCAN_W + x0;
      if (seen[i0] || !bright(i0)) continue;
      let head = 0;
      let tail = 0;
      qx[tail] = x0;
      qy[tail] = y0;
      tail++;
      seen[i0] = 1;
      let size = 0;
      let minX = x0;
      let maxX = x0;
      let minY = y0;
      let maxY = y0;
      while (head < tail) {
        const x = qx[head];
        const y = qy[head];
        head++;
        size++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        const tryPush = (nx: number, ny: number) => {
          if (nx < 0 || ny < 0 || nx >= SCAN_W || ny >= scanH) return;
          const ni = ny * SCAN_W + nx;
          if (!seen[ni] && bright(ni)) {
            seen[ni] = 1;
            qx[tail] = nx;
            qy[tail] = ny;
            tail++;
          }
        };
        tryPush(x - 1, y);
        tryPush(x + 1, y);
        tryPush(x, y - 1);
        tryPush(x, y + 1);
      }
      if (size > best.size) best = { size, minX, minY, maxX, maxY };
    }
  }
  if (best.size === 0) return null;
  const bw = best.maxX - best.minX + 1;
  const bh = best.maxY - best.minY + 1;
  const bboxArea = bw * bh;
  // Сторінка документа: ≥10% кадру, ≤75% кадру (інакше це сам слайд),
  // суцільна (текст — дрібні «дірки»), а поза нею — темний UI міта.
  if (best.size < N * 0.1) return null;
  if (bboxArea > N * 0.75) return null;
  if (best.size / bboxArea < 0.75) return null;
  let outSum = 0;
  let outCnt = 0;
  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < SCAN_W; x++) {
      if (x < best.minX || x > best.maxX || y < best.minY || y > best.maxY) {
        outSum += data[y * SCAN_W + x];
        outCnt++;
      }
    }
  }
  if (outCnt === 0 || outSum / outCnt > 90) return null;

  const sx = W / SCAN_W;
  const sy = H / scanH;
  const left = Math.max(0, Math.round(best.minX * sx));
  const top = Math.max(0, Math.round(best.minY * sy));
  const width = Math.min(W - left, Math.round(bw * sx));
  const height = Math.min(H - top, Math.round(bh * sy));
  if (width < 50 || height < 50) return null;
  return { left, top, width, height };
}

/** Зберігає слайд із data:-URL (null → прибрати). {ok} / {error,_status}. */
export async function setGroupSlide(id: number, body: Record<string, any>): Promise<Record<string, any>> {
  if (!one('SELECT 1 AS x FROM groups WHERE id = ?', [id])) return { error: 'групу не знайдено', _status: 404 };
  const v = body.slide_data_url;
  if (v === null || v === undefined || v === '') {
    run('UPDATE groups SET slide = NULL, slide_mime = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    logActivity('group.slide_clear', `#${id}`);
    return { ok: true, has_slide: 0 };
  }
  let mime: string;
  let blob: Buffer;
  try {
    [mime, blob] = parseDataUrl(String(v));
  } catch {
    return { error: 'bad data URL for slide_data_url', _status: 400 };
  }
  if (!mime.startsWith('image/')) return { error: 'слайд має бути зображенням', _status: 400 };
  let cropped = false;
  try {
    const meta = await sharp(blob).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 8 || h < 8) return { error: 'занадто мале зображення слайда', _status: 400 };
    // Скріншот усього міта замість слайда → обрізаємо до сторінки документа.
    const crop = await detectPresentationCrop(blob);
    if (crop) {
      blob = await sharp(blob).extract(crop).png().toBuffer();
      mime = 'image/png';
      cropped = true;
    }
    const meta2 = cropped ? await sharp(blob).metadata() : meta;
    if ((meta2.width ?? 0) > SLIDE_MAX_W || (meta2.height ?? 0) > SLIDE_MAX_H) {
      // PNG зберігає чіткість тексту слайдів краще за JPEG.
      blob = await sharp(blob)
        .resize(SLIDE_MAX_W, SLIDE_MAX_H, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      mime = 'image/png';
    }
  } catch {
    return { error: 'не вдалося прочитати зображення слайда', _status: 400 };
  }
  run('UPDATE groups SET slide = ?, slide_mime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [blob, mime, id]);
  logActivity('group.slide', `#${id} ${mime} ${blob.length} байт${cropped ? ' (авто-кроп зі скріншота міта)' : ''}`);
  return { ok: true, has_slide: 1, cropped: cropped ? 1 : 0 };
}

/**
 * Стартова міграція: слайди, завантажені ДО появи авто-кропу (повні скріншоти
 * міта), обрізаються до області презентації. Ідемпотентно: вже обрізаний слайд
 * (світла сторінка на весь кадр) детекцію не проходить.
 */
export async function autoCropExistingSlides(): Promise<void> {
  for (const g of all('SELECT id, slide FROM groups WHERE slide IS NOT NULL')) {
    const blob = toBuffer(g.slide);
    if (!blob || blob.length === 0) continue;
    try {
      const crop = await detectPresentationCrop(blob);
      if (!crop) continue;
      const out = await sharp(blob).extract(crop).png().toBuffer();
      run('UPDATE groups SET slide = ?, slide_mime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [out, 'image/png', g.id]);
      logActivity('group.slide_autocrop', `#${g.id} → ${crop.width}×${crop.height}`);
    } catch {
      /* не критично — слайд лишається як був */
    }
  }
}

export function activateGroup(id: number): Record<string, any> {
  if (!one('SELECT 1 AS x FROM groups WHERE id = ?', [id])) return { error: 'групу не знайдено', _status: 404 };
  run("INSERT INTO settings(key, value) VALUES('active_group_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [
    String(id),
  ]);
  logActivity('group.activate', `#${id}`);
  return { ok: true, active_group_id: id };
}
