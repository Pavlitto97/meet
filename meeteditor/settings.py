"""Читання/запис налаштувань зустрічі та AI-конфігу.

Секретні поля (`openrouter_api_key`) назовні не віддаємо — лише прапорець
`<key>_set`, чи воно встановлене.
"""
from . import config
from .db import db


def get_settings(*, include_secrets: bool = False) -> dict:
    with db() as con:
        rows = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM settings")}
    if include_secrets:
        return rows
    public = {}
    for k, v in rows.items():
        if k in config.SECRET_SETTING_KEYS:
            continue
        public[k] = v
    for k in config.SECRET_SETTING_KEYS:
        public[f"{k}_set"] = bool(rows.get(k))
    return public


def get_setting(key: str) -> str:
    with db() as con:
        row = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else ""


def update_settings(body: dict) -> dict:
    """Оновлює дозволені ключі. Повертає {ok:True, updated:[...]} або {error:...}."""
    updates = {k: v for k, v in body.items() if k in config.ALLOWED_SETTING_KEYS}
    if not updates:
        return {"error": "no allowed keys", "_status": 400}
    with db() as con:
        for k, v in updates.items():
            # Порожній рядок для секретів = очистити.
            val = "" if v is None else str(v)
            con.execute(
                "INSERT INTO settings(key, value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (k, val),
            )
    return {"ok": True, "updated": sorted(updates)}
