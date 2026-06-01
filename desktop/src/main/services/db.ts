/**
 * SQLite через ВБУДОВАНИЙ node:sqlite (Node 24 / Electron 42) — без нативної
 * збірки. Схема ідентична PHP-версії (той самий data.db читається без змін).
 * Один main-процес ⇒ одне підключення; gen-worker (utilityProcess) візьме власне.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { dbPath } from './paths';
import { DEFAULT_SETTINGS, defaultParticipants } from './config';

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(dbPath());
    _db.exec('PRAGMA journal_mode = WAL');
    _db.exec('PRAGMA foreign_keys = ON');
    _db.exec('PRAGMA busy_timeout = 5000');
  }
  return _db;
}

export function prepare(sql: string): StatementSync {
  return db().prepare(sql);
}

/** Усі рядки. */
export function all(sql: string, args: unknown[] = []): any[] {
  return prepare(sql).all(...(args as any[])) as any[];
}

/** Перший рядок або null. */
export function one(sql: string, args: unknown[] = []): any | null {
  const r = prepare(sql).get(...(args as any[]));
  return r === undefined ? null : r;
}

/** INSERT/UPDATE/DELETE → { changes, lastInsertRowid }. */
export function run(sql: string, args: unknown[] = []): { changes: number; lastInsertRowid: number } {
  const r = prepare(sql).run(...(args as any[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** node:sqlite повертає BLOB як Uint8Array — нормалізуємо у Buffer (або null). */
export function toBuffer(v: unknown): Buffer | null {
  if (v === null || v === undefined) return null;
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  return null;
}

function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = all(`PRAGMA table_info(${table})`).map((r) => r.name as string);
  if (!cols.includes(column)) {
    db().exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/** Створює таблиці, лагідні міграції, заливає дефолти. Ідемпотентно. */
export function initDb(): void {
  const con = db();
  con.exec(`
    CREATE TABLE IF NOT EXISTS participants (
      device_id       TEXT PRIMARY KEY,
      original_name   TEXT NOT NULL,
      custom_name     TEXT,
      avatar          BLOB,
      avatar_mime     TEXT,
      avatar_end      BLOB,
      avatar_end_mime TEXT,
      skipped         INTEGER NOT NULL DEFAULT 0,
      position        INTEGER NOT NULL,
      user_added      INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  ensureColumn('participants', 'user_added', 'user_added INTEGER NOT NULL DEFAULT 0');
  ensureColumn('participants', 'avatar_end', 'avatar_end BLOB');
  ensureColumn('participants', 'avatar_end_mime', 'avatar_end_mime TEXT');

  con.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');

  con.exec(`
    CREATE TABLE IF NOT EXISTS generations (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id TEXT,
      prompt         TEXT NOT NULL,
      model          TEXT NOT NULL,
      provider       TEXT NOT NULL,
      service_tier   TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      error          TEXT,
      image          BLOB,
      image_mime     TEXT,
      input_image    BLOB,
      input_mime     TEXT,
      cost_usd       REAL,
      prompt_tokens  INTEGER,
      output_tokens  INTEGER,
      degrade_pct    INTEGER,
      created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
      finished_at    TEXT
    )
  `);
  ensureColumn('generations', 'input_image', 'input_image BLOB');
  ensureColumn('generations', 'input_mime', 'input_mime TEXT');
  ensureColumn('generations', 'degrade_pct', 'degrade_pct INTEGER');

  con.exec(`
    CREATE TABLE IF NOT EXISTS prompt_presets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      body       TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  con.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      ts     TEXT DEFAULT CURRENT_TIMESTAMP,
      action TEXT NOT NULL,
      detail TEXT
    )
  `);
  con.exec(`
    CREATE TABLE IF NOT EXISTS screenshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      which        TEXT NOT NULL,
      image        BLOB NOT NULL,
      image_mime   TEXT NOT NULL DEFAULT 'image/png',
      width        INTEGER,
      height       INTEGER,
      meeting_code TEXT,
      label        TEXT,
      size_bytes   INTEGER,
      created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Дефолтні учасники.
  let pos = 0;
  for (const p of defaultParticipants()) {
    run(
      'INSERT OR IGNORE INTO participants(device_id, original_name, custom_name, skipped, position) VALUES(?,?,?,?,?)',
      [p.device_id, p.original_name, p.custom_name, p.skipped ? 1 : 0, pos]
    );
    if (p.custom_name) {
      run(
        "UPDATE participants SET custom_name = ? WHERE device_id = ? AND (custom_name IS NULL OR custom_name = '')",
        [p.custom_name, p.device_id]
      );
    }
    pos++;
  }

  // Дефолтні налаштування.
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    run('INSERT OR IGNORE INTO settings(key, value) VALUES(?,?)', [k, v]);
  }

  // OPENROUTER_API_KEY з оточення (.env через dotenv пріоритетніший за DB).
  const envKey = (process.env.OPENROUTER_API_KEY ?? '').trim();
  if (envKey !== '') {
    run(
      "INSERT INTO settings(key, value) VALUES('openrouter_api_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [envKey]
    );
  }
}

/** Журнал дій. Тихо ковтає помилки — лог не має валити запити. */
export function logActivity(action: string, detail = ''): void {
  try {
    run('INSERT INTO activity(action, detail) VALUES(?,?)', [action, detail]);
    db().exec('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 500)');
  } catch {
    /* журнал не критичний */
  }
}
