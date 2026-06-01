/** Агрегати та операції адмін-панелі (порт meeteditor/admin.php). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { all, one, run, db, logActivity, initDb, toBuffer } from './db';
import { getSettings } from './settings';
import { parseDataUrl, blobToDataUrl } from './media';
import { DEFAULT_SETTINGS } from './config';
import { dbPath, meetHtmlPath, meetHtmlBakPath, promptFile, rendererDir } from './paths';

const TABLES = ['participants', 'settings', 'generations', 'prompt_presets', 'activity', 'screenshots'];

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}
function pragmaInt(name: string): number {
  const row = one(`PRAGMA ${name}`);
  return row ? Number(Object.values(row)[0] ?? 0) : 0;
}
function countEntries(dir: string): number {
  try {
    return fs.readdirSync(dir).length;
  } catch {
    return 0;
  }
}

export function dashboardStats(): Record<string, any> {
  const p = one(
    'SELECT COUNT(*) AS total, ' +
      'SUM(CASE WHEN skipped=0 THEN 1 ELSE 0 END) AS editable, ' +
      'SUM(skipped) AS skipped, SUM(user_added) AS user_added, ' +
      'SUM(CASE WHEN avatar IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar, ' +
      'SUM(CASE WHEN avatar_end IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar_end, ' +
      "SUM(CASE WHEN custom_name IS NOT NULL AND custom_name!='' THEN 1 ELSE 0 END) AS named " +
      'FROM participants'
  );
  const g = one(
    'SELECT COUNT(*) AS total, ' +
      "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, " +
      "SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done, " +
      "SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error, " +
      'COALESCE(SUM(cost_usd),0) AS total_cost FROM generations'
  );
  const presets = Number(one('SELECT COUNT(*) AS n FROM prompt_presets')?.n ?? 0);
  const sc = one(
    'SELECT COUNT(*) AS total, ' +
      "SUM(CASE WHEN which='start' THEN 1 ELSE 0 END) AS starts, " +
      "SUM(CASE WHEN which='end' THEN 1 ELSE 0 END) AS ends, " +
      'COALESCE(SUM(size_bytes),0) AS bytes FROM screenshots'
  );
  const byModel = all('SELECT model, COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost FROM generations GROUP BY model ORDER BY cost DESC');
  const s = getSettings();
  return {
    participants: p,
    generations: g,
    screenshots: sc,
    cost_by_model: byModel,
    presets,
    db_size_bytes: fileSize(dbPath()),
    settings: {
      meeting_code: s.meeting_code ?? null,
      start: `${s.start_time ?? ''} ${s.start_period ?? ''}`,
      end: `${s.end_time ?? ''} ${s.end_period ?? ''}`,
      gen_model: s.gen_model ?? null,
      api_key_set: s.openrouter_api_key_set ?? false,
    },
  };
}

export function systemInfo(): Record<string, any> {
  const indexPresent = fs.existsSync(meetHtmlPath());
  let indexSize = 0;
  let indexParticipants = 0;
  if (indexPresent) {
    indexSize = fileSize(meetHtmlPath());
    const html = fs.readFileSync(meetHtmlPath()).toString('latin1');
    indexParticipants = (html.match(/data-participant-id="/g) || []).length;
  }
  const assets = path.join(rendererDir(), 'assets');
  return {
    index_html: { present: indexPresent, size: indexSize, participant_ids: indexParticipants },
    index_bak: { present: fs.existsSync(meetHtmlBakPath()), size: fileSize(meetHtmlBakPath()) },
    // У Electron Chromium вбудований — скріни доступні завжди.
    chrome: { available: true, path: `Electron Chromium ${process.versions.chrome}` },
    assets: {
      fonts: countEntries(path.join(assets, 'fonts')),
      img: countEntries(path.join(assets, 'img')),
      emoji: countEntries(path.join(assets, 'img', 'emoji')),
      vendor: countEntries(path.join(assets, 'vendor')),
    },
    php: null, // бекенд тепер Electron/Node, не PHP
    electron: process.versions.electron,
    node: process.versions.node,
    chromium: process.versions.chrome,
    app_version: app.getVersion(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    port: null, // транспорт — протокол app://, без HTTP-порту
    uptime_seconds: Math.round(process.uptime()),
    db_path: dbPath(),
  };
}

export function dbStats(): Record<string, any> {
  const counts: Record<string, number | null> = {};
  for (const t of TABLES) {
    try {
      counts[t] = Number(one(`SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0);
    } catch {
      counts[t] = null;
    }
  }
  return {
    rows: counts,
    size_bytes: fileSize(dbPath()),
    page_count: pragmaInt('page_count'),
    page_size: pragmaInt('page_size'),
    freelist_count: pragmaInt('freelist_count'),
  };
}

export function vacuum(): Record<string, any> {
  db().exec('VACUUM');
  logActivity('db.vacuum', '');
  return { ok: true, size_bytes: fileSize(dbPath()) };
}

export function resetDb(confirm: string): Record<string, any> {
  if (confirm !== 'RESET') return { error: "потрібен confirm: 'RESET'", _status: 400 };
  const con = db();
  for (const t of TABLES) con.exec(`DROP TABLE IF EXISTS ${t}`);
  initDb();
  logActivity('db.reset', '');
  return { ok: true };
}

export function restoreIndex(confirm: string): Record<string, any> {
  if (confirm !== 'RESTORE') return { error: "потрібен confirm: 'RESTORE'", _status: 400 };
  // У Electron рендер НІКОЛИ не мутує index.html (усе в памʼяті), а в пакеті
  // ресурси read-only. Тож відновлення доречне лише в dev і фактично не потрібне.
  if (app.isPackaged) {
    return { error: 'index.html у пакеті read-only й рендером не змінюється — відновлення не потрібне', _status: 400 };
  }
  if (!fs.existsSync(meetHtmlBakPath())) return { error: 'index.html.bak не знайдено', _status: 404 };
  fs.copyFileSync(meetHtmlBakPath(), meetHtmlPath());
  logActivity('index.restore', '');
  return { ok: true, size_bytes: fileSize(meetHtmlPath()) };
}

export function exportState(): Record<string, any> {
  const s = getSettings(); // без секретів
  delete (s as any).openrouter_api_key_set;
  const prows = all(
    'SELECT device_id, original_name, custom_name, skipped, position, user_added, ' +
      'avatar, avatar_mime, avatar_end, avatar_end_mime FROM participants ORDER BY position'
  );
  const presets = all('SELECT name, body FROM prompt_presets ORDER BY name');
  const participants = prows.map((r) => {
    const av = toBuffer(r.avatar);
    const avEnd = toBuffer(r.avatar_end);
    return {
      device_id: r.device_id,
      original_name: r.original_name,
      custom_name: r.custom_name,
      skipped: r.skipped,
      position: r.position,
      user_added: r.user_added,
      avatar_data_url: av && r.avatar_mime ? blobToDataUrl(r.avatar_mime, av) : null,
      avatar_end_data_url: avEnd && r.avatar_end_mime ? blobToDataUrl(r.avatar_end_mime, avEnd) : null,
    };
  });
  const prompt = fs.existsSync(promptFile()) ? fs.readFileSync(promptFile(), 'utf8') : '';
  return { version: 1, settings: s, prompt, presets, participants };
}

export function importState(data: any): Record<string, any> {
  if (!data || typeof data !== 'object') return { error: 'очікувався JSON-обʼєкт', _status: 400 };
  // Валідуємо/розпарсюємо учасників у памʼяті ДО запису.
  const parsed: any[] = [];
  for (const p of data.participants ?? []) {
    const did = p.device_id ?? null;
    if (!did) continue;
    let avatar: Buffer | null = null;
    let avatarMime: string | null = null;
    let avatarEnd: Buffer | null = null;
    let avatarEndMime: string | null = null;
    try {
      if (p.avatar_data_url) [avatarMime, avatar] = parseDataUrl(p.avatar_data_url);
      if (p.avatar_end_data_url) [avatarEndMime, avatarEnd] = parseDataUrl(p.avatar_end_data_url);
    } catch {
      return { error: `невалідні дані учасника ${did}: bad data URL`, _status: 400 };
    }
    // Числові гарди як у PHP import_state (інакше — 400, без часткового імпорту).
    const isNumericLike = (v: any) =>
      (typeof v === 'number' && Number.isFinite(v)) ||
      (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
    if (p.skipped !== undefined && typeof p.skipped !== 'boolean' && !isNumericLike(p.skipped)) {
      return { error: `невалідні дані учасника ${did}: skipped не число`, _status: 400 };
    }
    if (p.position !== undefined && !isNumericLike(p.position)) {
      return { error: `невалідні дані учасника ${did}: position не число`, _status: 400 };
    }
    parsed.push({
      did,
      custom_name: p.custom_name ?? null,
      original_name: p.original_name ?? p.custom_name ?? did,
      skipped: Number(p.skipped ?? 0) ? 1 : 0,
      position: parseInt(String(p.position ?? 0), 10) || 0,
      avatar,
      avatar_mime: avatarMime,
      avatar_end: avatarEnd,
      avatar_end_mime: avatarEndMime,
    });
  }

  const counts = { settings: 0, participants_updated: 0, participants_created: 0, presets: 0 };
  const con = db();
  con.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(data.settings ?? {})) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
        run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [
          k,
          v === null ? '' : String(v),
        ]);
        counts.settings++;
      }
    }
    for (const pr of data.presets ?? []) {
      if (pr.name && pr.body != null) {
        run(
          'INSERT INTO prompt_presets(name, body) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body, updated_at=CURRENT_TIMESTAMP',
          [pr.name, pr.body]
        );
        counts.presets++;
      }
    }
    for (const r of parsed) {
      const exists = one('SELECT 1 AS x FROM participants WHERE device_id = ?', [r.did]);
      if (exists) {
        run(
          'UPDATE participants SET custom_name=?, skipped=?, position=?, avatar=?, avatar_mime=?, ' +
            'avatar_end=?, avatar_end_mime=?, updated_at=CURRENT_TIMESTAMP WHERE device_id=?',
          [r.custom_name, r.skipped, r.position, r.avatar, r.avatar_mime, r.avatar_end, r.avatar_end_mime, r.did]
        );
        counts.participants_updated++;
      } else if (String(r.did).startsWith('local/')) {
        run(
          'INSERT INTO participants(device_id, original_name, custom_name, skipped, position, user_added, ' +
            'avatar, avatar_mime, avatar_end, avatar_end_mime) VALUES(?,?,?,?,?,1,?,?,?,?)',
          [r.did, r.original_name, r.custom_name, r.skipped, r.position, r.avatar, r.avatar_mime, r.avatar_end, r.avatar_end_mime]
        );
        counts.participants_created++;
      }
    }
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  if (typeof data.prompt === 'string') fs.writeFileSync(promptFile(), data.prompt);
  logActivity('state.import', JSON.stringify(counts));
  return { ok: true, ...counts };
}
