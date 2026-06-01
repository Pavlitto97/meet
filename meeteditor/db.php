<?php
/**
 * Підключення до SQLite (PDO), ініціалізація схеми та лагідні міграції.
 *
 * Схема ідентична колишній Python-версії — той самий data.db читається без змін:
 *   participants, settings, generations, prompt_presets, activity, screenshots.
 */
namespace Meet;

require_once __DIR__ . '/config.php';

/** Нове підключення. Кожен HTTP-запит / фоновий воркер бере власне. */
function db(): \PDO
{
    $con = new \PDO('sqlite:' . DB_PATH);
    $con->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
    $con->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC);
    $con->setAttribute(\PDO::ATTR_STRINGIFY_FETCHES, false); // INTEGER → int, не string
    $con->exec('PRAGMA foreign_keys = ON');
    $con->exec('PRAGMA busy_timeout = 5000');                // кілька процесів пишуть у файл
    return $con;
}

/** prepare+execute зручним рядком. Бінарні BLOB-и pdo_sqlite зберігає байт-безпечно. */
function q(\PDO $con, string $sql, array $args = []): \PDOStatement
{
    $st = $con->prepare($sql);
    $st->execute($args);
    return $st;
}

/** Перший рядок або null. */
function one(\PDO $con, string $sql, array $args = []): ?array
{
    $r = q($con, $sql, $args)->fetch(\PDO::FETCH_ASSOC);
    return $r === false ? null : $r;
}

/** Усі рядки. */
function all(\PDO $con, string $sql, array $args = []): array
{
    return q($con, $sql, $args)->fetchAll(\PDO::FETCH_ASSOC);
}

/**
 * Спершу process env, потім .env у корені проєкту. Парсимо примітивно:
 * KEY=VALUE на рядок, # — коментар, лапки навколо value прибираємо.
 */
function load_env_key(string $name): string
{
    $env = \getenv($name);
    if ($env !== false && \trim($env) !== '') {
        return \trim($env);
    }
    if (!\is_file(ENV_FILE)) {
        return '';
    }
    foreach (\file(ENV_FILE, FILE_IGNORE_NEW_LINES) as $line) {
        $line = \trim($line);
        if ($line === '' || $line[0] === '#' || \strpos($line, '=') === false) {
            continue;
        }
        [$k, $v] = \explode('=', $line, 2);
        if (\trim($k) === $name) {
            $v = \trim($v);
            $len = \strlen($v);
            if ($len >= 2 && (($v[0] === '"' && $v[$len - 1] === '"') || ($v[0] === "'" && $v[$len - 1] === "'"))) {
                $v = \substr($v, 1, -1);
            }
            return $v;
        }
    }
    return '';
}

/** Створює таблиці, виконує міграції, заливає дефолтні рядки. Ідемпотентно. */
function init_db(): void
{
    $con = db();
    $con->exec("
        CREATE TABLE IF NOT EXISTS participants (
            device_id     TEXT PRIMARY KEY,
            original_name TEXT NOT NULL,
            custom_name   TEXT,
            avatar        BLOB,
            avatar_mime   TEXT,
            skipped       INTEGER NOT NULL DEFAULT 0,
            position      INTEGER NOT NULL,
            user_added    INTEGER NOT NULL DEFAULT 0,
            updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ");
    // Лагідна міграція — якщо стара БД без user_added/avatar_end, додаємо.
    $cols = [];
    foreach (all($con, 'PRAGMA table_info(participants)') as $r) {
        $cols[$r['name']] = true;
    }
    if (!isset($cols['user_added'])) {
        $con->exec('ALTER TABLE participants ADD COLUMN user_added INTEGER NOT NULL DEFAULT 0');
    }
    if (!isset($cols['avatar_end'])) {
        $con->exec('ALTER TABLE participants ADD COLUMN avatar_end BLOB');
    }
    if (!isset($cols['avatar_end_mime'])) {
        $con->exec('ALTER TABLE participants ADD COLUMN avatar_end_mime TEXT');
    }
    $con->exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)");
    $con->exec("
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
            cost_usd       REAL,
            prompt_tokens  INTEGER,
            output_tokens  INTEGER,
            created_at     TEXT DEFAULT CURRENT_TIMESTAMP,
            finished_at    TEXT
        )
    ");
    // Лагідна міграція: вхідне (оригінальне) зображення, з якого генерували —
    // зберігаємо знімок, щоб картка показувала «оригінал → результат», а
    // перегенерація йшла з того самого оригіналу (а не з уже заміненого аватара).
    $gcols = [];
    foreach (all($con, 'PRAGMA table_info(generations)') as $r) {
        $gcols[$r['name']] = true;
    }
    if (!isset($gcols['input_image'])) {
        $con->exec('ALTER TABLE generations ADD COLUMN input_image BLOB');
    }
    if (!isset($gcols['input_mime'])) {
        $con->exec('ALTER TABLE generations ADD COLUMN input_mime TEXT');
    }
    // Авто-деградація: відсоток сили кодека, з яким зображення вже забейкано
    // (NULL = не деградовано). Лише для трасування/відображення в адмінці.
    if (!isset($gcols['degrade_pct'])) {
        $con->exec('ALTER TABLE generations ADD COLUMN degrade_pct INTEGER');
    }
    $con->exec("
        CREATE TABLE IF NOT EXISTS prompt_presets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE,
            body       TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    ");
    $con->exec("
        CREATE TABLE IF NOT EXISTS activity (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            ts     TEXT DEFAULT CURRENT_TIMESTAMP,
            action TEXT NOT NULL,
            detail TEXT
        )
    ");
    $con->exec("
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
    ");

    $pos = 0;
    foreach (default_participants() as [$did, $name, $display, $skipped]) {
        q(
            $con,
            'INSERT OR IGNORE INTO participants(device_id, original_name, custom_name, skipped, position) VALUES(?,?,?,?,?)',
            [$did, $name, $display, $skipped ? 1 : 0, $pos]
        );
        // Якщо рядок уже був (стара БД без дефолтних display name) — підкинемо
        // custom_name лише там, де його ще не задавали вручну.
        if ($display !== null && $display !== '') {
            q(
                $con,
                "UPDATE participants SET custom_name = ? WHERE device_id = ? AND (custom_name IS NULL OR custom_name = '')",
                [$display, $did]
            );
        }
        $pos++;
    }
    foreach (DEFAULT_SETTINGS as $k => $v) {
        q($con, 'INSERT OR IGNORE INTO settings(key, value) VALUES(?,?)', [$k, $v]);
    }

    // Підтягуємо OPENROUTER_API_KEY з process env / .env (.env пріоритетніший за DB).
    $envKey = load_env_key('OPENROUTER_API_KEY');
    if ($envKey !== '') {
        q(
            $con,
            "INSERT INTO settings(key, value) VALUES('openrouter_api_key', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [$envKey]
        );
    }

    // Лагідна міграція старих ключів time/period → start_time/start_period.
    $rows = [];
    foreach (all($con, 'SELECT key, value FROM settings') as $r) {
        $rows[$r['key']] = $r['value'];
    }
    if (!empty($rows['time']) && empty($rows['start_time'])) {
        q($con, "INSERT INTO settings(key, value) VALUES('start_time', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [$rows['time']]);
    }
    if (!empty($rows['period']) && empty($rows['start_period'])) {
        q($con, "INSERT INTO settings(key, value) VALUES('start_period', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [$rows['period']]);
    }
}

/** Записує подію у журнал. Тихо ковтає помилки — лог не має валити запити. */
function log_activity(string $action, string $detail = ''): void
{
    try {
        $con = db();
        q($con, 'INSERT INTO activity(action, detail) VALUES(?,?)', [$action, $detail]);
        // Тримаємо журнал коротким — лишаємо 500 останніх записів.
        $con->exec('DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 500)');
    } catch (\Throwable $e) {
        // журнал не критичний
    }
}
