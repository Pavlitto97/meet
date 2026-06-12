/** CRUD учасників. Учасник живе всередині групи (groups.ts); ідентифікатор — числовий id. */
import { randomBytes } from 'node:crypto';
import { all, one, run, db, logActivity, toBuffer } from './db';
import { parseDataUrl } from './media';
import { autoResizeForAvatar, normalizeSourceImage } from './degrade';

export function listParticipants(groupId: number): any[] {
  return all(
    'SELECT id, group_id, device_id, original_name, custom_name, ' +
      'source IS NOT NULL AS has_source, source_mime, ' +
      'avatar IS NOT NULL AS has_avatar, avatar_mime, ' +
      'avatar_end IS NOT NULL AS has_avatar_end, avatar_end_mime, ' +
      'skipped, user_added, position, updated_at ' +
      'FROM participants WHERE group_id = ? ORDER BY position',
    [groupId]
  );
}

export type ImageWhich = 'start' | 'end' | 'source';

const IMAGE_COLS: Record<ImageWhich, [string, string]> = {
  start: ['avatar', 'avatar_mime'],
  end: ['avatar_end', 'avatar_end_mime'],
  source: ['source', 'source_mime'],
};

/** [Buffer, mime] або null. which: start|end|source. */
export function participantImage(id: number, which: ImageWhich = 'start'): [Buffer, string] | null {
  const [blobCol, mimeCol] = IMAGE_COLS[which] ?? IMAGE_COLS.start;
  const row = one(`SELECT ${blobCol} AS blob, ${mimeCol} AS mime FROM participants WHERE id = ?`, [id]);
  const blob = toBuffer(row?.blob);
  if (!row || blob === null || !row.mime) return null;
  return [blob, row.mime];
}

/** Оновлює дозволені поля учасника. {ok} / {error,_status}. */
export async function updateParticipant(id: number, body: Record<string, any>): Promise<Record<string, any>> {
  const fields: Record<string, any> = {};
  if (Object.prototype.hasOwnProperty.call(body, 'custom_name')) {
    // Коерсуємо у рядок: node:sqlite не біндить boolean/число як TEXT-параметр.
    fields.custom_name = body.custom_name !== '' && body.custom_name !== null && body.custom_name !== undefined ? String(body.custom_name) : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'original_name')) {
    if (body.original_name) fields.original_name = String(body.original_name);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'skipped')) {
    fields.skipped = body.skipped ? 1 : 0;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'position')) {
    // is_numeric-парність: відсікаємо boolean / '' / нечислові рядки (PHP → 400).
    const pos = body.position;
    const numeric =
      (typeof pos === 'number' && Number.isFinite(pos)) ||
      (typeof pos === 'string' && pos.trim() !== '' && !Number.isNaN(Number(pos)));
    if (!numeric) {
      return { error: 'position має бути числом', _status: 400 };
    }
    fields.position = parseInt(String(pos), 10);
  }
  const imagePairs: Array<[string, string, string, 'avatar' | 'source']> = [
    ['avatar_data_url', 'avatar', 'avatar_mime', 'avatar'],
    ['avatar_end_data_url', 'avatar_end', 'avatar_end_mime', 'avatar'],
    ['source_data_url', 'source', 'source_mime', 'source'],
  ];
  for (const [bodyKey, blobCol, mimeCol, kind] of imagePairs) {
    if (!Object.prototype.hasOwnProperty.call(body, bodyKey)) continue;
    const v = body[bodyKey];
    if (v === null) {
      fields[blobCol] = null;
      fields[mimeCol] = null;
    } else {
      let mime: string;
      let blob: Buffer;
      try {
        [mime, blob] = parseDataUrl(String(v));
      } catch {
        return { error: `bad data URL for ${bodyKey}`, _status: 400 };
      }
      // Аватарки — downscale під плитку Meet; source лишається «оригіналом»
      // (тільки страховий downscale дуже великих фото під ліміт API).
      [blob, mime] = kind === 'source' ? await normalizeSourceImage(blob, mime) : await autoResizeForAvatar(blob, mime);
      fields[mimeCol] = mime;
      fields[blobCol] = blob;
    }
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return { error: 'nothing to update', _status: 400 };
  }
  const sets = keys.map((k) => `${k} = ?`).join(', ') + ', updated_at = CURRENT_TIMESTAMP';
  const r = run(`UPDATE participants SET ${sets} WHERE id = ?`, [...keys.map((k) => fields[k]), id]);
  if (r.changes === 0) {
    return { error: 'not found', _status: 404 };
  }
  logActivity('participant.update', `#${id}: ` + keys.join(','));
  return { ok: true };
}

export function createParticipant(groupId: number, body: Record<string, any>): Record<string, any> {
  const name = String(body.custom_name ?? '').trim();
  if (name === '') {
    return { error: 'custom_name required', _status: 400 };
  }
  const did = 'local/' + randomBytes(6).toString('hex');
  const row = one('SELECT COALESCE(MAX(position), -1) AS m FROM participants WHERE group_id = ?', [groupId]);
  const pos = Number(row?.m ?? -1) + 1;
  const r = run(
    'INSERT INTO participants(group_id, device_id, original_name, custom_name, skipped, position, user_added) VALUES(?,?,?,?,0,?,1)',
    [groupId, did, name, name, pos]
  );
  logActivity('participant.create', `#${r.lastInsertRowid} ${name} (група ${groupId})`);
  return { id: r.lastInsertRowid, device_id: did };
}

export function deleteParticipant(id: number, hard = false): Record<string, any> {
  if (hard) {
    const row = one('SELECT user_added FROM participants WHERE id = ?', [id]);
    if (!row) return { error: 'not found', _status: 404 };
    if (!row.user_added) return { error: 'не можна видалити дефолтного учасника', _status: 400 };
    run('DELETE FROM generations WHERE participant_id = ?', [id]);
    run('DELETE FROM participants WHERE id = ?', [id]);
    logActivity('participant.delete', `#${id}`);
  } else {
    run(
      'UPDATE participants SET custom_name=NULL, source=NULL, source_mime=NULL, avatar=NULL, avatar_mime=NULL, ' +
        'avatar_end=NULL, avatar_end_mime=NULL, updated_at=CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );
    logActivity('participant.reset', `#${id}`);
  }
  return { ok: true };
}

/** order = список id у бажаному порядку (в межах групи). Все-або-нічого. */
export function reorder(groupId: number, order: unknown): Record<string, any> {
  if (!Array.isArray(order) || order.length === 0) {
    return { error: 'order має бути непорожнім списком id', _status: 400 };
  }
  const ids = order.map((v) => parseInt(String(v), 10));
  const existing = new Set<number>(all('SELECT id FROM participants WHERE group_id = ?', [groupId]).map((r) => Number(r.id)));
  const missing = ids.filter((d) => !existing.has(d));
  if (missing.length) {
    return { error: 'невідомі id: ' + missing.slice(0, 5).join(', '), _status: 400 };
  }
  const con = db();
  con.exec('BEGIN');
  try {
    ids.forEach((pid, pos) => {
      run('UPDATE participants SET position = ? WHERE id = ?', [pos, pid]);
    });
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  logActivity('participant.reorder', `група ${groupId}: ${ids.length} шт`);
  return { ok: true, count: ids.length };
}
