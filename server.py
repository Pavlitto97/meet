#!/usr/bin/env python3
"""Локальний сервер для редактора Meet HTML.

Зберігає кастомні імена/аватарки учасників у SQLite, віддає згенерований
Meet HTML з застосованими правками. Без зовнішніх залежностей.

Запуск:
    python3 server.py
    Відкрити http://localhost:8000/editor.html
"""
import json
import re
import sqlite3
import sys
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).parent
DB_PATH = ROOT / "data.db"
MEET_HTML = ROOT / "Meet - yrt-kczi-csw.html"
PORT = 8000

# (device_id, оригінальне ім'я як воно є в HTML, пропустити з UI?)
# Pavlo Grinevich (126) і «3 others» (136/137/138) у UI не показуємо.
PARTICIPANTS = [
    ("spaces/mBsECBRYcS4B/devices/127", "Sandro Machaidze",              False),
    ("spaces/mBsECBRYcS4B/devices/129", "Ð¡Ð°Ð½Ñ",                       False),
    ("spaces/mBsECBRYcS4B/devices/131", "Ð\x92Ð°Ð½Ñ",                     False),
    ("spaces/mBsECBRYcS4B/devices/132", "Ð\x94Ð°Ð½Ñ",                     False),
    ("spaces/mBsECBRYcS4B/devices/133", "Ð\x94Ð¸Ð¼Ð°",                    False),
    ("spaces/mBsECBRYcS4B/devices/134", "Ð\x9cÐ¸ÐºÐ¸Ñ\x82Ð°",              False),
    ("spaces/mBsECBRYcS4B/devices/135", "Ð\x9cÐ¸ÐºÐ¾Ð»Ð°\\",              False),
    ("spaces/mBsECBRYcS4B/devices/126", "Pavlo Grinevich",                True),
    ("spaces/mBsECBRYcS4B/devices/136", "Ð\x93Ñ\x80Ð¸Ñ\x88Ð°",             True),
    ("spaces/mBsECBRYcS4B/devices/137", "Ð\x9fÐ°Ð²Ð»Ð¾",                  True),
    ("spaces/mBsECBRYcS4B/devices/138", "Ð\x9aÐ¸Ñ\x80Ð¸Ð»Ð¾",              True),
]


# ─── БД ────────────────────────────────────────────────────────────────────

def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


DEFAULT_SETTINGS = {
    "time":         "10:34",          # number part у footer
    "period":       "PM",              # AM/PM
    "meeting_code": "yrt-kczi-csw",    # хеш зустрічі
}


def init_db():
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
                updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        for pos, (did, name, skipped) in enumerate(PARTICIPANTS):
            con.execute(
                "INSERT OR IGNORE INTO participants(device_id, original_name, skipped, position) VALUES(?,?,?,?)",
                (did, name, int(skipped), pos),
            )
        for k, v in DEFAULT_SETTINGS.items():
            con.execute("INSERT OR IGNORE INTO settings(key, value) VALUES(?,?)", (k, v))


def get_settings() -> dict:
    with db() as con:
        return {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM settings")}


# Початковий код зустрічі — щоб точно знати, що замінювати на новий.
ORIGINAL_MEETING_CODE = "yrt-kczi-csw"
ORIGINAL_TIME = "10:34"
ORIGINAL_PERIOD = "PM"


# ─── Рендер Meet HTML ──────────────────────────────────────────────────────

def render_meet() -> str:
    html = MEET_HTML.read_text(encoding="utf-8")
    occ = [(m.start(), m.end(), m.group(1))
           for m in re.finditer(r'data-participant-id="([^"]+)"', html)]

    with db() as con:
        rows = {r["device_id"]: r for r in con.execute(
            "SELECT device_id, original_name, custom_name, avatar, avatar_mime FROM participants"
        )}

    img_re = re.compile(r'<img\b[^>]*?\ssrc="([^"]*)"')
    edits = []  # (start, end, replacement)

    for i, (pos_start, pos_end, pid) in enumerate(occ):
        row = rows.get(pid)
        if not row:
            continue
        bound = occ[i + 1][0] if i + 1 < len(occ) else len(html)
        tile = html[pos_end:bound]

        # Аватарка — замінити src у всіх <img>
        if row["avatar"]:
            data_url = f"data:{row['avatar_mime']};base64,{b64encode(row['avatar']).decode()}"
            for m in img_re.finditer(tile):
                val_start = pos_end + m.end() - len(m.group(1)) - 1
                val_end = val_start + len(m.group(1))
                edits.append((val_start, val_end, data_url))

    edits.sort(key=lambda e: e[0], reverse=True)
    for start, end, repl in edits:
        html = html[:start] + repl + html[end:]

    # ─ імена: глобальна заміна (Sandro з’являється і в банері презентації,
    # і в плитці учасника — це одна людина, треба замінити скрізь) ─
    with db() as con:
        name_pairs = list(con.execute(
            "SELECT original_name, custom_name FROM participants "
            "WHERE custom_name IS NOT NULL AND custom_name != ''"
        ))
    # Сортуємо за спаданням довжини оригіналу — щоб довші імена замінялись
    # перші, інакше короткі підрядки можуть зіпсувати довші.
    name_pairs.sort(key=lambda r: -len(r["original_name"]))
    for r in name_pairs:
        if r["custom_name"] != r["original_name"]:
            html = html.replace(r["original_name"], r["custom_name"])

    # ─ глобальні налаштування (час, період, код зустрічі) ─
    s = get_settings()
    # Хеш зустрічі — глобальна заміна (унікальний рядок: title, tooltip, видимий
    # лейбл, data-meeting-title, etc).
    new_code = (s.get("meeting_code") or ORIGINAL_MEETING_CODE).strip()
    if new_code and new_code != ORIGINAL_MEETING_CODE:
        html = html.replace(ORIGINAL_MEETING_CODE, new_code)
    # Час — точкові заміни всередині відомих span-ів
    new_time = (s.get("time") or ORIGINAL_TIME).strip()
    if new_time and new_time != ORIGINAL_TIME:
        html = re.sub(
            r'(<span jsname="W5i7Bf">)' + re.escape(ORIGINAL_TIME) + r'(</span>)',
            lambda m: m.group(1) + new_time + m.group(2),
            html, count=1,
        )
    new_period = (s.get("period") or ORIGINAL_PERIOD).strip()
    if new_period and new_period != ORIGINAL_PERIOD:
        html = re.sub(
            r'(<span jsname="d1rraf"[^>]*>)' + re.escape(ORIGINAL_PERIOD) + r'(</span>)',
            lambda m: m.group(1) + new_period + m.group(2),
            html, count=1,
        )
    return html


# ─── HTTP ──────────────────────────────────────────────────────────────────

class H(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _text(self, code, ctype, body: bytes, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        n = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(n)) if n else {}

    # ─── routes ─────────────────────────────────────────────────────────

    def do_GET(self):
        u = urlparse(self.path)
        path, query = u.path, parse_qs(u.query)

        if path == "/api/settings":
            return self._json(200, get_settings())

        if path == "/api/participants":
            with db() as con:
                rows = list(con.execute(
                    "SELECT device_id, original_name, custom_name, "
                    "avatar IS NOT NULL AS has_avatar, avatar_mime, skipped, position "
                    "FROM participants ORDER BY position"
                ))
            return self._json(200, [dict(r) for r in rows])

        if path.startswith("/api/avatar/"):
            did = path[len("/api/avatar/"):]
            with db() as con:
                row = con.execute(
                    "SELECT avatar, avatar_mime FROM participants WHERE device_id = ?",
                    (did,),
                ).fetchone()
            if not row or not row["avatar"]:
                return self._text(404, "text/plain", b"no avatar")
            return self._text(200, row["avatar_mime"], row["avatar"],
                              {"Cache-Control": "no-store"})

        if path == "/api/render":
            html = render_meet().encode("utf-8")
            headers = {}
            if query.get("download"):
                headers["Content-Disposition"] = (
                    'attachment; filename="Meet - yrt-kczi-csw.html"'
                )
            return self._text(200, "text/html; charset=utf-8", html, headers)

        # статика з ROOT
        return self._serve_file(path)

    def do_PUT(self):
        u = urlparse(self.path)
        if u.path == "/api/settings":
            body = self._read_json()
            allowed = {"time", "period", "meeting_code"}
            updates = {k: v for k, v in body.items() if k in allowed}
            if not updates:
                return self._json(400, {"error": "no allowed keys"})
            with db() as con:
                for k, v in updates.items():
                    con.execute(
                        "INSERT INTO settings(key, value) VALUES(?,?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (k, v),
                    )
            return self._json(200, {"ok": True})

        if u.path.startswith("/api/participants/"):
            did = u.path[len("/api/participants/"):]
            body = self._read_json()
            fields = {}
            if "custom_name" in body:
                fields["custom_name"] = body["custom_name"] or None
            if "avatar_data_url" in body:
                v = body["avatar_data_url"]
                if v is None:
                    fields["avatar"] = None
                    fields["avatar_mime"] = None
                else:
                    m = re.match(r"data:([^;]+);base64,(.+)", v, re.DOTALL)
                    if not m:
                        return self._json(400, {"error": "bad data URL"})
                    import base64
                    fields["avatar_mime"] = m.group(1)
                    fields["avatar"] = base64.b64decode(m.group(2))
            if not fields:
                return self._json(400, {"error": "nothing to update"})
            sets = ", ".join(f"{k} = ?" for k in fields)
            sets += ", updated_at = CURRENT_TIMESTAMP"
            with db() as con:
                cur = con.execute(
                    f"UPDATE participants SET {sets} WHERE device_id = ?",
                    (*fields.values(), did),
                )
                if cur.rowcount == 0:
                    return self._json(404, {"error": "not found"})
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "no route"})

    def do_DELETE(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/participants/"):
            did = u.path[len("/api/participants/"):]
            with db() as con:
                con.execute(
                    "UPDATE participants SET custom_name=NULL, avatar=NULL, "
                    "avatar_mime=NULL, updated_at=CURRENT_TIMESTAMP "
                    "WHERE device_id = ?",
                    (did,),
                )
            return self._json(200, {"ok": True})
        return self._json(404, {"error": "no route"})

    def _serve_file(self, path):
        if path == "/":
            path = "/editor.html"
        rel = path.lstrip("/")
        target = (ROOT / rel).resolve()
        try:
            target.relative_to(ROOT.resolve())
        except ValueError:
            return self._text(403, "text/plain", b"forbidden")
        if not target.is_file():
            return self._text(404, "text/plain", b"not found")
        ext = target.suffix.lower()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css":  "text/css; charset=utf-8",
            ".js":   "application/javascript; charset=utf-8",
            ".svg":  "image/svg+xml",
            ".png":  "image/png",
            ".jpg":  "image/jpeg", ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".woff": "font/woff", ".woff2": "font/woff2",
            ".json": "application/json; charset=utf-8",
        }.get(ext, "application/octet-stream")
        return self._text(200, ctype, target.read_bytes())


if __name__ == "__main__":
    init_db()
    print(f"Serving on http://localhost:{PORT}  (editor: /editor.html)")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
