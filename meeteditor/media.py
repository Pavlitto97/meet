"""Допоміжні функції для роботи із зображеннями та data: URL.

Спільні для завантаження аватарок, генерацій і рендера.
"""
import base64
import re
from base64 import b64encode

from .db import db


def parse_data_url(data_url: str) -> tuple[str, bytes]:
    """`data:image/png;base64,....` → ("image/png", b"...байти..."). ValueError якщо ні."""
    m = re.match(r"data:([^;]+);base64,(.+)", data_url, re.DOTALL)
    if not m:
        raise ValueError("expected data:<mime>;base64,<...>")
    return m.group(1), base64.b64decode(m.group(2))


def blob_to_data_url(mime: str, blob: bytes) -> str:
    return f"data:{mime};base64,{b64encode(blob).decode()}"


def avatar_data_url(participant_id: str, which: str = "start") -> str | None:
    """data: URL аватарки учасника (start|end). None якщо немає."""
    blob_col = "avatar_end" if which == "end" else "avatar"
    mime_col = "avatar_end_mime" if which == "end" else "avatar_mime"
    with db() as con:
        row = con.execute(
            f"SELECT {blob_col} AS blob, {mime_col} AS mime FROM participants WHERE device_id = ?",
            (participant_id,),
        ).fetchone()
    # mime обовʼязковий — без нього вийшов би невалідний "data:None;base64,…".
    if not row or not row["blob"] or not row["mime"]:
        return None
    return blob_to_data_url(row["mime"], row["blob"])
