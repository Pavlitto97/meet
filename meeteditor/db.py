"""Підключення до SQLite, ініціалізація схеми та лагідні міграції.

Схема:
    participants    — учасники зустрічі (ім'я, дві аватарки start/end, позиція)
    settings        — пари ключ→значення (час, код зустрічі, AI-конфіг, секрети)
    generations     — черга AI-генерацій аватарок
    prompt_presets  — збережені іменовані промти (нова можливість адмінки)
    activity        — журнал останніх дій (для адмінки)
"""
import os
import sqlite3

from . import config


def db() -> sqlite3.Connection:
    """Нове підключення. Кожен HTTP-запит бере власне — ThreadingHTTPServer."""
    con = sqlite3.connect(config.DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def _load_env_key(name: str) -> str:
    """Спершу process env, потім .env у корені проєкту. Парсимо примітивно:
    KEY=VALUE на рядок, # — коментар, лапки навколо value прибираємо."""
    if os.environ.get(name):
        return os.environ[name].strip()
    if not config.ENV_FILE.is_file():
        return ""
    for line in config.ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() == name:
            v = v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            return v
    return ""


def init_db() -> None:
    """Створює таблиці, виконує міграції, заливає дефолтні рядки. Ідемпотентно."""
    with db() as con:
        con.execute("""
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
        """)
        # Лагідна міграція — якщо стара БД без user_added/avatar_end, додаємо.
        cols = {r[1] for r in con.execute("PRAGMA table_info(participants)")}
        if "user_added" not in cols:
            con.execute("ALTER TABLE participants ADD COLUMN user_added INTEGER NOT NULL DEFAULT 0")
        if "avatar_end" not in cols:
            con.execute("ALTER TABLE participants ADD COLUMN avatar_end BLOB")
        if "avatar_end_mime" not in cols:
            con.execute("ALTER TABLE participants ADD COLUMN avatar_end_mime TEXT")
        con.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        con.execute("""
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
        """)
        # Нові таблиці адмінки.
        con.execute("""
            CREATE TABLE IF NOT EXISTS prompt_presets (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL UNIQUE,
                body       TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS activity (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                ts     TEXT DEFAULT CURRENT_TIMESTAMP,
                action TEXT NOT NULL,
                detail TEXT
            )
        """)

        for pos, (did, name, display, skipped) in enumerate(config.PARTICIPANTS):
            con.execute(
                "INSERT OR IGNORE INTO participants(device_id, original_name, custom_name, skipped, position) VALUES(?,?,?,?,?)",
                (did, name, display, int(skipped), pos),
            )
            # Якщо рядок уже був (стара БД без дефолтних display name) —
            # підкинемо custom_name лише там, де його ще не задавали вручну.
            if display:
                con.execute(
                    "UPDATE participants SET custom_name = ? WHERE device_id = ? AND (custom_name IS NULL OR custom_name = '')",
                    (display, did),
                )
        for k, v in config.DEFAULT_SETTINGS.items():
            con.execute("INSERT OR IGNORE INTO settings(key, value) VALUES(?,?)", (k, v))

        # Підтягуємо OPENROUTER_API_KEY з process env / .env. Якщо файл .env є
        # — він пріоритетніший за DB (тобі простіше: змінив у .env → перезапустив).
        # Видалив .env → DB-значення (наприклад, з UI) лишається.
        env_key = _load_env_key("OPENROUTER_API_KEY")
        if env_key:
            con.execute(
                "INSERT INTO settings(key, value) VALUES('openrouter_api_key', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (env_key,),
            )

        # Лагідна міграція старих ключів `time`/`period` → `start_time`/`start_period`.
        rows = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM settings")}
        if rows.get("time") and not rows.get("start_time"):
            con.execute(
                "INSERT INTO settings(key, value) VALUES('start_time', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (rows["time"],),
            )
        if rows.get("period") and not rows.get("start_period"):
            con.execute(
                "INSERT INTO settings(key, value) VALUES('start_period', ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (rows["period"],),
            )


def log_activity(action: str, detail: str = "") -> None:
    """Записує подію у журнал. Тихо ковтає помилки — лог не має валити запити."""
    try:
        with db() as con:
            con.execute(
                "INSERT INTO activity(action, detail) VALUES(?,?)", (action, detail)
            )
            # Тримаємо журнал коротким — лишаємо 500 останніх записів.
            con.execute(
                "DELETE FROM activity WHERE id NOT IN "
                "(SELECT id FROM activity ORDER BY id DESC LIMIT 500)"
            )
    except Exception:  # noqa: BLE001 — журнал не критичний
        pass
