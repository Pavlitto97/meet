/** Групи учасників: CRUD + активна група (її учасники йдуть у рендер і скріни). */
import { all, one, run, db, logActivity, seedGroupParticipants } from './db';
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
      COUNT(p.id) AS participants,
      SUM(CASE WHEN p.skipped = 0 THEN 1 ELSE 0 END) AS editable,
      SUM(CASE WHEN p.source IS NOT NULL THEN 1 ELSE 0 END) AS with_source,
      SUM(CASE WHEN p.avatar IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar,
      SUM(CASE WHEN p.avatar_end IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar_end
    FROM groups g LEFT JOIN participants p ON p.group_id = g.id
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

export function activateGroup(id: number): Record<string, any> {
  if (!one('SELECT 1 AS x FROM groups WHERE id = ?', [id])) return { error: 'групу не знайдено', _status: 404 };
  run("INSERT INTO settings(key, value) VALUES('active_group_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [
    String(id),
  ]);
  logActivity('group.activate', `#${id}`);
  return { ok: true, active_group_id: id };
}
