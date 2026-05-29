"""CRUD учасників: список, оновлення (ім'я/аватарки/skip/позиція), додавання,
видалення, перевпорядкування."""
import uuid

from .db import db, log_activity
from .media import parse_data_url


def list_participants() -> list[dict]:
    with db() as con:
        rows = list(con.execute(
            "SELECT device_id, original_name, custom_name, "
            "avatar IS NOT NULL AS has_avatar, avatar_mime, "
            "avatar_end IS NOT NULL AS has_avatar_end, avatar_end_mime, "
            "skipped, user_added, position, updated_at "
            "FROM participants ORDER BY position"
        ))
    return [dict(r) for r in rows]


def avatar_blob(did: str, which: str = "start") -> tuple[bytes, str] | None:
    blob_col = "avatar_end" if which == "end" else "avatar"
    mime_col = "avatar_end_mime" if which == "end" else "avatar_mime"
    with db() as con:
        row = con.execute(
            f"SELECT {blob_col} AS blob, {mime_col} AS mime FROM participants WHERE device_id = ?",
            (did,),
        ).fetchone()
    # mime теж обовʼязковий — інакше Response отримає content_type=None.
    if not row or not row["blob"] or not row["mime"]:
        return None
    return row["blob"], row["mime"]


def update_participant(did: str, body: dict) -> dict:
    """Оновлює дозволені поля учасника. Повертає {ok} / {error,_status}.

    Поля: custom_name, original_name, skipped, position,
          avatar_data_url, avatar_end_data_url (None = очистити).
    """
    fields: dict = {}
    if "custom_name" in body:
        fields["custom_name"] = body["custom_name"] or None
    if "original_name" in body:
        # original_name NOT NULL — порожнє ігноруємо.
        if body["original_name"]:
            fields["original_name"] = str(body["original_name"])
    if "skipped" in body:
        fields["skipped"] = 1 if body["skipped"] else 0
    if "position" in body:
        try:
            fields["position"] = int(body["position"])
        except (TypeError, ValueError):
            return {"error": "position має бути числом", "_status": 400}
    for body_key, blob_col, mime_col in (
        ("avatar_data_url",     "avatar",     "avatar_mime"),
        ("avatar_end_data_url", "avatar_end", "avatar_end_mime"),
    ):
        if body_key not in body:
            continue
        v = body[body_key]
        if v is None:
            fields[blob_col] = None
            fields[mime_col] = None
        else:
            try:
                mime, blob = parse_data_url(v)
            except ValueError:
                return {"error": f"bad data URL for {body_key}", "_status": 400}
            fields[mime_col] = mime
            fields[blob_col] = blob
    if not fields:
        return {"error": "nothing to update", "_status": 400}
    sets = ", ".join(f"{k} = ?" for k in fields)
    sets += ", updated_at = CURRENT_TIMESTAMP"
    with db() as con:
        cur = con.execute(
            f"UPDATE participants SET {sets} WHERE device_id = ?",
            (*fields.values(), did),
        )
        if cur.rowcount == 0:
            return {"error": "not found", "_status": 404}
    log_activity("participant.update", f"{did}: {sorted(fields)}")
    return {"ok": True}


def create_participant(body: dict) -> dict:
    name = (body.get("custom_name") or "").strip()
    if not name:
        return {"error": "custom_name required", "_status": 400}
    # Локальний ID для віртуального учасника — не зачіпає рендер index.html
    # (там тільки spaces/.../devices/NNN з фіксованого списку).
    did = f"local/{uuid.uuid4().hex[:12]}"
    with db() as con:
        row = con.execute("SELECT COALESCE(MAX(position), -1) AS m FROM participants").fetchone()
        pos = (row["m"] or 0) + 1
        con.execute(
            "INSERT INTO participants(device_id, original_name, custom_name, "
            "skipped, position, user_added) VALUES(?,?,?,0,?,1)",
            (did, name, name, pos),
        )
    log_activity("participant.create", f"{did} {name}")
    return {"device_id": did}


def delete_participant(did: str, hard: bool = False) -> dict:
    with db() as con:
        if hard:
            # Видаляємо повністю — це безпечно лише для user_added, бо інакше при
            # наступному старті init_db() повторно вставить дефолтний рядок.
            row = con.execute(
                "SELECT user_added FROM participants WHERE device_id = ?", (did,)
            ).fetchone()
            if not row:
                return {"error": "not found", "_status": 404}
            if not row["user_added"]:
                return {"error": "не можна видалити дефолтного учасника", "_status": 400}
            con.execute("DELETE FROM participants WHERE device_id = ?", (did,))
            log_activity("participant.delete", did)
        else:
            con.execute(
                "UPDATE participants SET custom_name=NULL, avatar=NULL, "
                "avatar_mime=NULL, avatar_end=NULL, avatar_end_mime=NULL, "
                "updated_at=CURRENT_TIMESTAMP WHERE device_id = ?",
                (did,),
            )
            log_activity("participant.reset", did)
    return {"ok": True}


def reorder(order: list[str]) -> dict:
    """order = список device_id у бажаному порядку. Перезаписує position.

    Спершу перевіряємо, що ВСІ id існують — інакше UPDATE невідомого id тихо
    зачепить 0 рядків і порядок мовчки зіпсується. При невалідному id нічого не
    пишемо й повертаємо 400.
    """
    if not isinstance(order, list) or not order:
        return {"error": "order має бути непорожнім списком device_id", "_status": 400}
    with db() as con:
        existing = {r["device_id"] for r in con.execute("SELECT device_id FROM participants")}
        missing = [d for d in order if d not in existing]
        if missing:
            return {"error": f"невідомі device_id: {missing[:5]}", "_status": 400}
        for pos, did in enumerate(order):
            con.execute(
                "UPDATE participants SET position = ? WHERE device_id = ?", (pos, did)
            )
    log_activity("participant.reorder", f"{len(order)} шт")
    return {"ok": True, "count": len(order)}
