"""Агрегати та операції для адмін-панелі.

Статистика для дашборду, інфо про систему/БД, експорт/імпорт стану, керування
промт-пресетами, журнал активності та небезпечні операції (reset/restore/vacuum).
"""
import platform
import re
import shutil
import sqlite3
import sys
import time

from . import config
from .db import db, init_db, log_activity
from .media import avatar_data_url
from .settings import get_settings


# ─── Дашборд / статистика ─────────────────────────────────────────────────────

def dashboard_stats() -> dict:
    with db() as con:
        p = con.execute(
            "SELECT "
            "COUNT(*) AS total, "
            "SUM(CASE WHEN skipped=0 THEN 1 ELSE 0 END) AS editable, "
            "SUM(skipped) AS skipped, "
            "SUM(user_added) AS user_added, "
            "SUM(CASE WHEN avatar IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar, "
            "SUM(CASE WHEN avatar_end IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar_end, "
            "SUM(CASE WHEN custom_name IS NOT NULL AND custom_name!='' THEN 1 ELSE 0 END) AS named "
            "FROM participants"
        ).fetchone()
        g = con.execute(
            "SELECT "
            "COUNT(*) AS total, "
            "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, "
            "SUM(CASE WHEN status='done'    THEN 1 ELSE 0 END) AS done, "
            "SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END) AS error, "
            "COALESCE(SUM(cost_usd),0) AS total_cost "
            "FROM generations"
        ).fetchone()
        presets = con.execute("SELECT COUNT(*) AS n FROM prompt_presets").fetchone()["n"]
        # Вартість за моделями.
        by_model = [
            dict(r) for r in con.execute(
                "SELECT model, COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost "
                "FROM generations GROUP BY model ORDER BY cost DESC"
            )
        ]
    s = get_settings()
    return {
        "participants": dict(p),
        "generations": dict(g),
        "cost_by_model": by_model,
        "presets": presets,
        "db_size_bytes": config.DB_PATH.stat().st_size if config.DB_PATH.is_file() else 0,
        "settings": {
            "meeting_code": s.get("meeting_code"),
            "start": f"{s.get('start_time')} {s.get('start_period')}",
            "end": f"{s.get('end_time')} {s.get('end_period')}",
            "gen_model": s.get("gen_model"),
            "api_key_set": s.get("openrouter_api_key_set"),
        },
    }


# ─── Система ──────────────────────────────────────────────────────────────────

def system_info() -> dict:
    from . import state  # пізній імпорт, щоб уникнути циклів
    index_present = config.MEET_HTML.is_file()
    index_size = config.MEET_HTML.stat().st_size if index_present else 0
    index_participants = 0
    if index_present:
        try:
            html = config.MEET_HTML.read_text(encoding="utf-8")
            index_participants = len(re.findall(r'data-participant-id="', html))
        except Exception:  # noqa: BLE001
            index_participants = -1
    bak_present = config.MEET_HTML_BAK.is_file()
    bak_size = config.MEET_HTML_BAK.stat().st_size if bak_present else 0

    def _count(p):
        return sum(1 for _ in p.glob("*")) if p.is_dir() else 0

    assets = config.ROOT / "assets"
    return {
        "index_html": {"present": index_present, "size": index_size,
                       "participant_ids": index_participants},
        "index_bak": {"present": bak_present, "size": bak_size},
        "assets": {
            "fonts": _count(assets / "fonts"),
            "img": _count(assets / "img"),
            "emoji": _count(assets / "img" / "emoji"),
            "vendor": _count(assets / "vendor"),
        },
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "port": state.PORT,
        "uptime_seconds": round(time.time() - state.STARTED_AT),
        "db_path": str(config.DB_PATH),
    }


def db_stats() -> dict:
    tables = ["participants", "settings", "generations", "prompt_presets", "activity"]
    with db() as con:
        counts = {}
        for t in tables:
            try:
                counts[t] = con.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"]
            except sqlite3.OperationalError:
                counts[t] = None
        page_count = con.execute("PRAGMA page_count").fetchone()[0]
        page_size = con.execute("PRAGMA page_size").fetchone()[0]
        freelist = con.execute("PRAGMA freelist_count").fetchone()[0]
    return {
        "rows": counts,
        "size_bytes": config.DB_PATH.stat().st_size if config.DB_PATH.is_file() else 0,
        "page_count": page_count,
        "page_size": page_size,
        "freelist_count": freelist,
    }


def vacuum() -> dict:
    with db() as con:
        con.execute("VACUUM")
    log_activity("db.vacuum", "")
    return {"ok": True, "size_bytes": config.DB_PATH.stat().st_size}


def reset_db(confirm: str) -> dict:
    """Скидає БД до дефолтів. Потрібен confirm == 'RESET' щоб уникнути випадковостей."""
    if confirm != "RESET":
        return {"error": "потрібен confirm: 'RESET'", "_status": 400}
    with db() as con:
        for t in ("participants", "settings", "generations", "prompt_presets", "activity"):
            con.execute(f"DROP TABLE IF EXISTS {t}")
    init_db()
    log_activity("db.reset", "")
    return {"ok": True}


def restore_index(confirm: str) -> dict:
    """Відновлює index.html з index.html.bak. confirm == 'RESTORE'."""
    if confirm != "RESTORE":
        return {"error": "потрібен confirm: 'RESTORE'", "_status": 400}
    if not config.MEET_HTML_BAK.is_file():
        return {"error": "index.html.bak не знайдено", "_status": 404}
    shutil.copyfile(config.MEET_HTML_BAK, config.MEET_HTML)
    log_activity("index.restore", "")
    return {"ok": True, "size_bytes": config.MEET_HTML.stat().st_size}


# ─── Експорт / імпорт ───────────────────────────────────────────────────────────

def export_state() -> dict:
    """Повний знімок стану (без секретів) для бекапу/перенесення."""
    s = get_settings()  # без секретів
    s.pop("openrouter_api_key_set", None)
    with db() as con:
        prows = list(con.execute(
            "SELECT device_id, original_name, custom_name, skipped, position, "
            "user_added, avatar, avatar_mime, avatar_end, avatar_end_mime FROM participants ORDER BY position"
        ))
        presets = [dict(r) for r in con.execute(
            "SELECT name, body FROM prompt_presets ORDER BY name"
        )]
    from .media import blob_to_data_url
    participants = []
    for r in prows:
        # both blob і mime — інакше data:URL був би невалідний ("data:None;…").
        start_url = blob_to_data_url(r["avatar_mime"], r["avatar"]) if (r["avatar"] and r["avatar_mime"]) else None
        end_url = blob_to_data_url(r["avatar_end_mime"], r["avatar_end"]) if (r["avatar_end"] and r["avatar_end_mime"]) else None
        participants.append({
            "device_id": r["device_id"],
            "original_name": r["original_name"],
            "custom_name": r["custom_name"],
            "skipped": r["skipped"],
            "position": r["position"],
            "user_added": r["user_added"],
            "avatar_data_url": start_url,
            "avatar_end_data_url": end_url,
        })
    try:
        prompt = config.PROMPT_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        prompt = ""
    return {
        "version": 1,
        "settings": s,
        "prompt": prompt,
        "presets": presets,
        "participants": participants,
    }


def import_state(data: dict) -> dict:
    """Застосовує знімок export_state. Учасники оновлюються за device_id,
    нові local/* створюються. Налаштування — лише дозволені ключі."""
    from .media import parse_data_url
    if not isinstance(data, dict):
        return {"error": "очікувався JSON-обʼєкт", "_status": 400}

    # Спершу повністю валідуємо й розпарсюємо учасників У ПАМ'ЯТІ — до будь-якого
    # запису в БД. Невалідний data:URL / нечислові skipped|position не повалять
    # сервер 500-кою і не залишать частково застосований імпорт: повертаємо 400.
    parsed = []
    for p in (data.get("participants") or []):
        did = p.get("device_id")
        if not did:
            continue
        try:
            avatar = avatar_mime = avatar_end = avatar_end_mime = None
            if p.get("avatar_data_url"):
                avatar_mime, avatar = parse_data_url(p["avatar_data_url"])
            if p.get("avatar_end_data_url"):
                avatar_end_mime, avatar_end = parse_data_url(p["avatar_end_data_url"])
            skipped = int(p.get("skipped") or 0)
            position = int(p.get("position") or 0)
        except (ValueError, TypeError) as e:
            return {"error": f"невалідні дані учасника {did}: {e}", "_status": 400}
        parsed.append({
            "did": did, "custom_name": p.get("custom_name"),
            "original_name": p.get("original_name") or p.get("custom_name") or did,
            "skipped": skipped, "position": position,
            "avatar": avatar, "avatar_mime": avatar_mime,
            "avatar_end": avatar_end, "avatar_end_mime": avatar_end_mime,
        })

    counts = {"settings": 0, "participants_updated": 0, "participants_created": 0, "presets": 0}
    with db() as con:
        # settings
        for k, v in (data.get("settings") or {}).items():
            if k in config.ALLOWED_SETTING_KEYS:
                con.execute(
                    "INSERT INTO settings(key,value) VALUES(?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, "" if v is None else str(v)),
                )
                counts["settings"] += 1
        # presets
        for pr in (data.get("presets") or []):
            if pr.get("name") and pr.get("body") is not None:
                con.execute(
                    "INSERT INTO prompt_presets(name, body) VALUES(?,?) "
                    "ON CONFLICT(name) DO UPDATE SET body=excluded.body, updated_at=CURRENT_TIMESTAMP",
                    (pr["name"], pr["body"]),
                )
                counts["presets"] += 1
        # participants (уже валідні)
        for r in parsed:
            exists = con.execute(
                "SELECT 1 FROM participants WHERE device_id = ?", (r["did"],)
            ).fetchone()
            if exists:
                con.execute(
                    "UPDATE participants SET custom_name=?, skipped=?, position=?, "
                    "avatar=?, avatar_mime=?, avatar_end=?, avatar_end_mime=?, "
                    "updated_at=CURRENT_TIMESTAMP WHERE device_id=?",
                    (r["custom_name"], r["skipped"], r["position"],
                     r["avatar"], r["avatar_mime"], r["avatar_end"], r["avatar_end_mime"], r["did"]),
                )
                counts["participants_updated"] += 1
            elif r["did"].startswith("local/"):
                con.execute(
                    "INSERT INTO participants(device_id, original_name, custom_name, "
                    "skipped, position, user_added, avatar, avatar_mime, avatar_end, avatar_end_mime) "
                    "VALUES(?,?,?,?,?,1,?,?,?,?)",
                    (r["did"], r["original_name"], r["custom_name"], r["skipped"], r["position"],
                     r["avatar"], r["avatar_mime"], r["avatar_end"], r["avatar_end_mime"]),
                )
                counts["participants_created"] += 1
    # prompt — пишемо у файл
    if "prompt" in data and isinstance(data["prompt"], str):
        config.PROMPT_FILE.write_text(data["prompt"], encoding="utf-8")
    log_activity("state.import", str(counts))
    return {"ok": True, **counts}


# ─── Промт-пресети ────────────────────────────────────────────────────────────

def list_presets() -> list[dict]:
    with db() as con:
        return [dict(r) for r in con.execute(
            "SELECT id, name, body, created_at, updated_at FROM prompt_presets ORDER BY name"
        )]


def save_preset(name: str, body: str) -> dict:
    name = (name or "").strip()
    if not name:
        return {"error": "name required", "_status": 400}
    with db() as con:
        con.execute(
            "INSERT INTO prompt_presets(name, body) VALUES(?,?) "
            "ON CONFLICT(name) DO UPDATE SET body=excluded.body, updated_at=CURRENT_TIMESTAMP",
            (name, body or ""),
        )
    log_activity("preset.save", name)
    return {"ok": True}


def delete_preset(preset_id: int) -> dict:
    with db() as con:
        con.execute("DELETE FROM prompt_presets WHERE id = ?", (preset_id,))
    return {"ok": True}


# ─── Журнал активності ──────────────────────────────────────────────────────────

def list_activity(limit: int = 100) -> list[dict]:
    limit = max(1, min(int(limit or 100), 500))
    with db() as con:
        return [dict(r) for r in con.execute(
            "SELECT id, ts, action, detail FROM activity ORDER BY id DESC LIMIT ?", (limit,)
        )]
