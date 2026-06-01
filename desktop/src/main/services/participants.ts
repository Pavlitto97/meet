/** CRUD учасників (порт meeteditor/participants.php). */
import { randomBytes } from 'node:crypto';
import { all, one, run, db, logActivity, toBuffer } from './db';
import { parseDataUrl } from './media';
import { autoResizeForAvatar } from './degrade';

export function listParticipants(): any[] {
  return all(
    'SELECT device_id, original_name, custom_name, ' +
      'avatar IS NOT NULL AS has_avatar, avatar_mime, ' +
      'avatar_end IS NOT NULL AS has_avatar_end, avatar_end_mime, ' +
      'skipped, user_added, position, updated_at ' +
      'FROM participants ORDER BY position'
  );
}

/** [Buffer, mime] або null. */
export function avatarBlob(did: string, which: 'start' | 'end' = 'start'): [Buffer, string] | null {
  const blobCol = which === 'end' ? 'avatar_end' : 'avatar';
  const mimeCol = which === 'end' ? 'avatar_end_mime' : 'avatar_mime';
  const row = one(`SELECT ${blobCol} AS blob, ${mimeCol} AS mime FROM participants WHERE device_id = ?`, [did]);
  const blob = toBuffer(row?.blob);
  if (!row || blob === null || !row.mime) return null;
  return [blob, row.mime];
}

/** Оновлює дозволені поля учасника. {ok} / {error,_status}. */
export async function updateParticipant(did: string, body: Record<string, any>): Promise<Record<string, any>> {
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
  const avatarPairs: Array<[string, string, string]> = [
    ['avatar_data_url', 'avatar', 'avatar_mime'],
    ['avatar_end_data_url', 'avatar_end', 'avatar_end_mime'],
  ];
  for (const [bodyKey, blobCol, mimeCol] of avatarPairs) {
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
      // downscale-only під плитку Meet (повторні PUT малого нічого не псують).
      [blob, mime] = await autoResizeForAvatar(blob, mime);
      fields[mimeCol] = mime;
      fields[blobCol] = blob;
    }
  }
  const keys = Object.keys(fields);
  if (keys.length === 0) {
    return { error: 'nothing to update', _status: 400 };
  }
  const sets = keys.map((k) => `${k} = ?`).join(', ') + ', updated_at = CURRENT_TIMESTAMP';
  const r = run(`UPDATE participants SET ${sets} WHERE device_id = ?`, [...keys.map((k) => fields[k]), did]);
  if (r.changes === 0) {
    return { error: 'not found', _status: 404 };
  }
  logActivity('participant.update', did + ': ' + keys.join(','));
  return { ok: true };
}

export function createParticipant(body: Record<string, any>): Record<string, any> {
  const name = String(body.custom_name ?? '').trim();
  if (name === '') {
    return { error: 'custom_name required', _status: 400 };
  }
  const did = 'local/' + randomBytes(6).toString('hex');
  const row = one('SELECT COALESCE(MAX(position), -1) AS m FROM participants');
  const pos = Number(row?.m ?? -1) + 1;
  run(
    'INSERT INTO participants(device_id, original_name, custom_name, skipped, position, user_added) VALUES(?,?,?,0,?,1)',
    [did, name, name, pos]
  );
  logActivity('participant.create', `${did} ${name}`);
  return { device_id: did };
}

export function deleteParticipant(did: string, hard = false): Record<string, any> {
  if (hard) {
    const row = one('SELECT user_added FROM participants WHERE device_id = ?', [did]);
    if (!row) return { error: 'not found', _status: 404 };
    if (!row.user_added) return { error: 'не можна видалити дефолтного учасника', _status: 400 };
    run('DELETE FROM participants WHERE device_id = ?', [did]);
    logActivity('participant.delete', did);
  } else {
    run(
      'UPDATE participants SET custom_name=NULL, avatar=NULL, avatar_mime=NULL, ' +
        'avatar_end=NULL, avatar_end_mime=NULL, updated_at=CURRENT_TIMESTAMP WHERE device_id = ?',
      [did]
    );
    logActivity('participant.reset', did);
  }
  return { ok: true };
}

/** order = список device_id у бажаному порядку. Перезаписує position (все-або-нічого). */
export function reorder(order: unknown): Record<string, any> {
  if (!Array.isArray(order) || order.length === 0) {
    return { error: 'order має бути непорожнім списком device_id', _status: 400 };
  }
  const existing = new Set<string>(all('SELECT device_id FROM participants').map((r) => r.device_id));
  const missing = order.filter((d) => !existing.has(d as string));
  if (missing.length) {
    return { error: 'невідомі device_id: ' + missing.slice(0, 5).join(', '), _status: 400 };
  }
  const con = db();
  con.exec('BEGIN');
  try {
    order.forEach((did, pos) => {
      run('UPDATE participants SET position = ? WHERE device_id = ?', [pos, did]);
    });
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  logActivity('participant.reorder', order.length + ' шт');
  return { ok: true, count: order.length };
}
