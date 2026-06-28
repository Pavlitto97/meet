/**
 * SQLite через ВБУДОВАНИЙ node:sqlite (Node 24 / Electron 42) — без нативної
 * збірки. Схема ідентична PHP-версії (той самий data.db читається без змін).
 * Один main-процес ⇒ одне підключення; gen-worker (utilityProcess) візьме власне.
 */
import fs from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { dbPath, promptFile, promptSeedPath } from './paths';
import {
  DEFAULT_SETTINGS,
  DEFAULT_GROUP_NAME,
  defaultParticipants,
  LEGACY_SPACE,
  LEGACY_DEVICE_MAP,
} from './config';

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

function tableExists(name: string): boolean {
  return !!one("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
}

function tableHasColumn(table: string, column: string): boolean {
  return all(`PRAGMA table_info(${table})`).some((r) => r.name === column);
}

const PARTICIPANTS_DDL = `
    CREATE TABLE IF NOT EXISTS participants (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id        INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      device_id       TEXT NOT NULL,
      original_name   TEXT NOT NULL,
      custom_name     TEXT,
      source          BLOB,
      source_mime     TEXT,
      avatar          BLOB,
      avatar_mime     TEXT,
      avatar_end      BLOB,
      avatar_end_mime TEXT,
      skipped         INTEGER NOT NULL DEFAULT 0,
      position        INTEGER NOT NULL,
      user_added      INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(group_id, device_id)
    )
`;

/** Сідить дефолтних учасників (плитки збереженої сторінки Meet) у групу. */
export function seedGroupParticipants(groupId: number): void {
  let pos = 0;
  for (const p of defaultParticipants()) {
    run(
      'INSERT OR IGNORE INTO participants(group_id, device_id, original_name, custom_name, skipped, position) VALUES(?,?,?,?,?,?)',
      [groupId, p.device_id, p.original_name, p.custom_name, p.skipped ? 1 : 0, pos]
    );
    pos++;
  }
}

/**
 * Стара одногрупна форма (device_id PRIMARY KEY) → групова: створюємо групу №1,
 * перебудовуємо participants із числовим id + group_id + source, перешиваємо
 * generations.participant_id (device_id → числовий id).
 */
function migrateParticipantsToGroups(): void {
  const con = db();
  con.exec('BEGIN');
  try {
    run('INSERT OR IGNORE INTO groups(id, name) VALUES(1, ?)', [DEFAULT_GROUP_NAME]);
    con.exec('ALTER TABLE participants RENAME TO participants_old');
    con.exec(PARTICIPANTS_DDL);
    con.exec(`
      INSERT INTO participants(group_id, device_id, original_name, custom_name,
        avatar, avatar_mime, avatar_end, avatar_end_mime, skipped, position, user_added, updated_at)
      SELECT 1, device_id, original_name, custom_name,
        avatar, avatar_mime, avatar_end, avatar_end_mime, skipped, position, user_added, updated_at
      FROM participants_old
    `);
    con.exec('DROP TABLE participants_old');
    if (tableExists('generations')) {
      con.exec(`
        UPDATE generations SET participant_id = (
          SELECT p.id FROM participants p
          WHERE p.group_id = 1 AND p.device_id = generations.participant_id
        )
        WHERE participant_id LIKE 'spaces/%' OR participant_id LIKE 'local/%'
      `);
    }
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Шаблон yrt-kczi-csw → mqy-kiph-fci: редаговані слоти переїжджають на нові
 * device_id за LEGACY_DEVICE_MAP (кастомні імена/фото/генерації зберігаються —
 * числовий id рядка не міняється), original_name перешивається під байти нового
 * шаблону. Слоти без пари у новому шаблоні видаляються разом із генераціями.
 */
function migrateLegacyTemplate(): void {
  const legacy = all('SELECT id, group_id, device_id FROM participants WHERE device_id LIKE ?', [LEGACY_SPACE + '/%']);
  if (legacy.length === 0) return;
  const defaults = new Map(defaultParticipants().map((d) => [d.device_id, d]));
  const con = db();
  con.exec('BEGIN');
  try {
    for (const row of legacy) {
      const target = LEGACY_DEVICE_MAP[row.device_id];
      const def = target ? defaults.get(target) : undefined;
      const taken = target ? one('SELECT id FROM participants WHERE group_id = ? AND device_id = ?', [row.group_id, target]) : null;
      if (target && def && !taken) {
        run('UPDATE participants SET device_id = ?, original_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
          target,
          def.original_name,
          row.id,
        ]);
      } else {
        run('DELETE FROM generations WHERE participant_id = ?', [String(row.id)]);
        run('DELETE FROM participants WHERE id = ?', [row.id]);
      }
    }
    con.exec('COMMIT');
  } catch (e) {
    con.exec('ROLLBACK');
    throw e;
  }
  logActivity('db.migrate', `шаблон mqy-kiph-fci: оброблено ${legacy.length} legacy-слотів`);
}

/**
 * 12-год час (start_period/end_period) → 24-год (як в Україні). Ключі *_period
 * прибрано з налаштувань; значення часу конвертується на місці. Старий дефолтний
 * код зустрічі підміняється новим.
 */
function migrateTimeSettings(): void {
  for (const which of ['start', 'end'] as const) {
    const period = one('SELECT value FROM settings WHERE key = ?', [`${which}_period`]);
    if (!period) continue;
    const t = one('SELECT value FROM settings WHERE key = ?', [`${which}_time`]);
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t?.value ?? '').trim());
    if (m) {
      let h = parseInt(m[1], 10) % 12;
      if (String(period.value ?? '').toUpperCase() === 'PM') h += 12;
      run('UPDATE settings SET value = ? WHERE key = ?', [`${String(h).padStart(2, '0')}:${m[2]}`, `${which}_time`]);
    }
    run('DELETE FROM settings WHERE key = ?', [`${which}_period`]);
  }
  run("UPDATE settings SET value = ? WHERE key = 'meeting_code' AND value = 'yrt-kczi-csw'", [DEFAULT_SETTINGS.meeting_code]);
}

/** Створює таблиці, лагідні міграції, заливає дефолти. Ідемпотентно. */
export function initDb(): void {
  const con = db();
  con.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  if (tableExists('participants') && !tableHasColumn('participants', 'group_id')) {
    migrateParticipantsToGroups();
  } else {
    con.exec(PARTICIPANTS_DDL);
  }
  ensureColumn('participants', 'source', 'source BLOB');
  ensureColumn('participants', 'source_mime', 'source_mime TEXT');
  // М'яке видалення дефолтних слотів: рядок лишається (UNIQUE-захист від
  // повторного сіду), UI/рендер його ігнорують; можна відновити.
  ensureColumn('participants', 'deleted', 'deleted INTEGER NOT NULL DEFAULT 0');
  // Слайд презентації групи: зображення, що вставляється у відео-область шаблону.
  ensureColumn('groups', 'slide', 'slide BLOB');
  ensureColumn('groups', 'slide_mime', 'slide_mime TEXT');

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
  // approved_at — генерація «застосована» до учасника (історія НЕ видаляється).
  ensureColumn('generations', 'approved_at', 'approved_at TEXT');
  // Ретуш (блюр/пікселізація/замазування): image перезаписується відредагованим,
  // оригінал генерації відкладається в image_orig — можна відновити.
  ensureColumn('generations', 'image_orig', 'image_orig BLOB');
  ensureColumn('generations', 'image_orig_mime', 'image_orig_mime TEXT');
  // Нормалізація: node:sqlite біндить JS-число як REAL, і TEXT-колонка
  // participant_id осідала як "1.0" — зводимо до цілого тексту "1".
  run("UPDATE generations SET participant_id = CAST(CAST(participant_id AS INTEGER) AS TEXT) WHERE participant_id LIKE '%.0'");

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
  // Скрін привʼязується до групи, з якої рендерився.
  ensureColumn('screenshots', 'group_id', 'group_id INTEGER');

  // Хоч одна група мусить існувати.
  const groupCount = Number(one('SELECT COUNT(*) AS n FROM groups')?.n ?? 0);
  if (groupCount === 0) {
    run('INSERT INTO groups(name) VALUES(?)', [DEFAULT_GROUP_NAME]);
  }
  // Перенос даних зі старого шаблону — ДО сіда, щоб мапінг не вперся в нові слоти.
  migrateLegacyTemplate();
  migrateTimeSettings();
  // Дефолтні слоти плиток у КОЖНІЙ групі — ідемпотентно (INSERT OR IGNORE по
  // UNIQUE(group_id, device_id)); лікує і неповні стани після міграцій.
  for (const g of all('SELECT id FROM groups')) {
    seedGroupParticipants(g.id);
  }

  // Дефолтні налаштування.
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    run('INSERT OR IGNORE INTO settings(key, value) VALUES(?,?)', [k, v]);
  }

  // Сідимо promt.md із бандла у userData при першому запуску (інакше промт порожній).
  try {
    if (!fs.existsSync(promptFile()) && fs.existsSync(promptSeedPath())) {
      fs.copyFileSync(promptSeedPath(), promptFile());
    }
  } catch {
    /* промт не критичний для старту */
  }

  // OPENROUTER_API_KEY з оточення (.env) — це лише ДЕФОЛТ, що вшивається у білд.
  // Сидимо ним БД ЛИШЕ якщо ключ ще не заданий: так заміна токена користувачем у
  // Налаштуваннях переживає перезапуск (env більше НЕ перетирає DB щоразу).
  const envKey = (process.env.OPENROUTER_API_KEY ?? '').trim();
  if (envKey !== '') {
    const cur = String(one("SELECT value FROM settings WHERE key = 'openrouter_api_key'")?.value ?? '').trim();
    if (cur === '') {
      run(
        "INSERT INTO settings(key, value) VALUES('openrouter_api_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [envKey]
      );
    }
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
