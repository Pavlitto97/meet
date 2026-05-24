#!/usr/bin/env python3
"""Локальний сервер для редактора Meet HTML.

Зберігає кастомні імена/аватарки учасників у SQLite, віддає згенерований
Meet HTML з застосованими правками. Без зовнішніх залежностей.

Запуск:
    python3 server.py
    Відкрити http://localhost:8000/editor.html
"""
import base64
import json
import os
import re
import sqlite3
import sys
import threading
import traceback
import urllib.request
import urllib.error
import uuid
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote

ROOT = Path(__file__).parent
DB_PATH = ROOT / "data.db"
MEET_HTML = ROOT / "index.html"
PROMPT_FILE = ROOT / "promt.md"
PORT = 8000

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
# Slug-и, що використовуються у /api/generate і UI
DEFAULT_GEN_MODEL = "google/gemini-2.5-flash-image"
DEFAULT_GEN_PROVIDER = "google-ai-studio"
DEFAULT_GEN_TIER = "default"

# (device_id, оригінальне ім'я як воно є в HTML, дефолтне відображуване ім'я, пропустити з UI?)
# Pavlo Grinevich (126) і «3 others» (136/137/138) у UI не показуємо.
# display_name заливається у custom_name при ініціалізації БД — щоб у рендері й
# редакторі одразу були нормальні Cyrillic-імена замість mojibake-байтів з HTML.
PARTICIPANTS = [
    ("spaces/mBsECBRYcS4B/devices/127", "Sandro Machaidze",              "Sandro Machaidze", False),
    ("spaces/mBsECBRYcS4B/devices/129", "Ð¡Ð°Ð½Ñ",                       "Саня",             False),
    ("spaces/mBsECBRYcS4B/devices/131", "Ð\x92Ð°Ð½Ñ",                     "Ваня",             False),
    ("spaces/mBsECBRYcS4B/devices/132", "Ð\x94Ð°Ð½Ñ",                     "Даня",             False),
    ("spaces/mBsECBRYcS4B/devices/133", "Ð\x94Ð¸Ð¼Ð°",                    "Дима",             False),
    ("spaces/mBsECBRYcS4B/devices/134", "Ð\x9cÐ¸ÐºÐ¸Ñ\x82Ð°",              "Микита",           False),
    ("spaces/mBsECBRYcS4B/devices/135", "Ð\x9cÐ¸ÐºÐ¾Ð»Ð°\\",              "Микола",           False),
    ("spaces/mBsECBRYcS4B/devices/126", "Pavlo Grinevich",                None,               True),
    ("spaces/mBsECBRYcS4B/devices/136", "Ð\x93Ñ\x80Ð¸Ñ\x88Ð°",             None,               True),
    ("spaces/mBsECBRYcS4B/devices/137", "Ð\x9fÐ°Ð²Ð»Ð¾",                  None,               True),
    ("spaces/mBsECBRYcS4B/devices/138", "Ð\x9aÐ¸Ñ\x80Ð¸Ð»Ð¾",              None,               True),
]


# ─── БД ────────────────────────────────────────────────────────────────────

def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


DEFAULT_SETTINGS = {
    "time":               "10:34",                  # number part у footer
    "period":             "PM",                      # AM/PM
    "meeting_code":       "yrt-kczi-csw",            # хеш зустрічі
    "openrouter_api_key": "",                        # порожньо = не задано
    "gen_model":          DEFAULT_GEN_MODEL,
    "gen_provider":       DEFAULT_GEN_PROVIDER,
    "gen_tier":           DEFAULT_GEN_TIER,
}

# Налаштування, які можна змінювати через /api/settings PUT.
ALLOWED_SETTING_KEYS = set(DEFAULT_SETTINGS.keys())
# Секретні поля — назовні віддаємо лише факт "встановлено/ні".
SECRET_SETTING_KEYS = {"openrouter_api_key"}


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
                user_added    INTEGER NOT NULL DEFAULT 0,
                updated_at    TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Лагідна міграція — якщо стара БД без user_added, додаємо колонку.
        cols = {r[1] for r in con.execute("PRAGMA table_info(participants)")}
        if "user_added" not in cols:
            con.execute("ALTER TABLE participants ADD COLUMN user_added INTEGER NOT NULL DEFAULT 0")
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
        for pos, (did, name, display, skipped) in enumerate(PARTICIPANTS):
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
        for k, v in DEFAULT_SETTINGS.items():
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


def _load_env_key(name: str) -> str:
    """Спершу process env, потім .env у корені проєкту. Парсимо примітивно:
    KEY=VALUE на рядок, # — коментар, лапки навколо value прибираємо."""
    if os.environ.get(name):
        return os.environ[name].strip()
    env_file = ROOT / ".env"
    if not env_file.is_file():
        return ""
    for line in env_file.read_text(encoding="utf-8").splitlines():
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


def get_settings(*, include_secrets: bool = False) -> dict:
    with db() as con:
        rows = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM settings")}
    if include_secrets:
        return rows
    # Назовні замінюємо секрети на boolean-індикатор "встановлено?".
    public = {}
    for k, v in rows.items():
        if k in SECRET_SETTING_KEYS:
            continue
        public[k] = v
    for k in SECRET_SETTING_KEYS:
        public[f"{k}_set"] = bool(rows.get(k))
    return public


def get_setting(key: str) -> str:
    with db() as con:
        row = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else ""


# ─── OpenRouter ────────────────────────────────────────────────────────────

def _openrouter_headers(api_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        # Доброзичливі заголовки рекомендовані доками OpenRouter
        "HTTP-Referer":  "http://localhost:8000/",
        "X-Title":       "Meet Editor",
    }


def fetch_openrouter_credits(api_key: str) -> dict:
    req = urllib.request.Request(
        OPENROUTER_CREDITS_URL,
        headers=_openrouter_headers(api_key),
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def _parse_data_url(data_url: str) -> tuple[str, bytes]:
    m = re.match(r"data:([^;]+);base64,(.+)", data_url, re.DOTALL)
    if not m:
        raise ValueError("expected data:<mime>;base64,<...>")
    return m.group(1), base64.b64decode(m.group(2))


def _avatar_data_url(participant_id: str) -> str | None:
    with db() as con:
        row = con.execute(
            "SELECT avatar, avatar_mime FROM participants WHERE device_id = ?",
            (participant_id,),
        ).fetchone()
    if not row or not row["avatar"]:
        return None
    return f"data:{row['avatar_mime']};base64,{b64encode(row['avatar']).decode()}"


def call_openrouter_image(
    api_key: str,
    *,
    model: str,
    provider: str,
    service_tier: str,
    prompt: str,
    input_image_data_url: str | None,
) -> dict:
    """Викликає chat.completions з modalities=[text,image] і повертає JSON-відповідь."""
    # OpenRouter повертає 404 "No endpoints support modalities text,image" якщо
    # модель не вміє генерувати картинки (напр. google/gemini-3.5-flash —
    # текстова). Раніше відсікаємо з зрозумілою помилкою.
    if "image" not in model.lower():
        raise RuntimeError(
            f"Модель «{model}» не підтримує генерацію зображень. "
            f"Вибери модель з «image» в назві (напр. google/gemini-2.5-flash-image)."
        )
    content: list = [{"type": "text", "text": prompt}]
    if input_image_data_url:
        content.append({"type": "image_url", "image_url": {"url": input_image_data_url}})
    body: dict = {
        "model": model,
        "modalities": ["text", "image"],
        "messages": [{"role": "user", "content": content}],
        # Просимо повернути cost у usage.
        "usage": {"include": True},
    }
    if service_tier and service_tier != "default":
        body["service_tier"] = service_tier
    if provider:
        body["provider"] = {"only": [provider], "allow_fallbacks": False}
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(body).encode("utf-8"),
        headers=_openrouter_headers(api_key),
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # OpenRouter повертає JSON з error.message — піднімаємо його як виключення.
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenRouter HTTP {e.code}: {err_body}") from e


def _extract_image_from_response(resp: dict) -> tuple[str, bytes]:
    """Витягує першу картинку з відповіді OpenRouter.

    Підтримуємо два формати: message.images=[{image_url:{url:data:...}}] та
    message.content як список з елементом type=image_url.
    """
    choices = resp.get("choices") or []
    if not choices:
        raise RuntimeError("OpenRouter: choices порожній")
    msg = choices[0].get("message", {}) or {}
    # Варіант 1: окремий масив images
    for img in msg.get("images") or []:
        url = (img.get("image_url") or {}).get("url") if isinstance(img, dict) else None
        if url and url.startswith("data:"):
            return _parse_data_url(url)
    # Варіант 2: content як масив частин
    content = msg.get("content")
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url")
                if url and url.startswith("data:"):
                    return _parse_data_url(url)
    raise RuntimeError("OpenRouter: у відповіді немає image_url у data:base64 форматі")


def _run_generation(gen_id: int):
    """Виконується у фоновому потоці. Оновлює рядок generations."""
    try:
        with db() as con:
            row = con.execute(
                "SELECT id, participant_id, prompt, model, provider, service_tier "
                "FROM generations WHERE id = ?",
                (gen_id,),
            ).fetchone()
        if not row:
            return
        api_key = get_setting("openrouter_api_key")
        if not api_key:
            raise RuntimeError("OpenRouter API key не задано. Введи його у налаштуваннях.")
        input_url = _avatar_data_url(row["participant_id"]) if row["participant_id"] else None
        resp = call_openrouter_image(
            api_key,
            model=row["model"],
            provider=row["provider"],
            service_tier=row["service_tier"],
            prompt=row["prompt"],
            input_image_data_url=input_url,
        )
        mime, blob = _extract_image_from_response(resp)
        usage = resp.get("usage") or {}
        cost = usage.get("cost")
        ptok = usage.get("prompt_tokens")
        otok = usage.get("completion_tokens") or usage.get("output_tokens")
        with db() as con:
            con.execute(
                "UPDATE generations SET status='done', image=?, image_mime=?, "
                "cost_usd=?, prompt_tokens=?, output_tokens=?, "
                "finished_at=CURRENT_TIMESTAMP WHERE id=?",
                (blob, mime, cost, ptok, otok, gen_id),
            )
    except Exception as e:  # noqa: BLE001 — фіксуємо у статусі
        msg = "".join(traceback.format_exception_only(type(e), e)).strip()
        with db() as con:
            con.execute(
                "UPDATE generations SET status='error', error=?, "
                "finished_at=CURRENT_TIMESTAMP WHERE id=?",
                (msg, gen_id),
            )


# Початковий код зустрічі — щоб точно знати, що замінювати на новий.
ORIGINAL_MEETING_CODE = "yrt-kczi-csw"
ORIGINAL_TIME = "10:34"
ORIGINAL_PERIOD = "PM"

# Emoji у нижньому реакц-тулбарі. cleanup/rewrite зачистили оригінальні
# fonts.gstatic.com URL і поставили placeholder.svg для всіх <img class="iiJ4W">.
# Тут мапимо data-emoji на локальні PNG з noto-emoji у assets/img/emoji/.
#
# Атрибут data-emoji у файлі — double-encoded mojibake: оригінальні UTF-8 байти
# emoji (наприклад F0 9F 92 96 для 💖) ще раз пройшли утф-8-кодування через
# latin1-інтерпретацію → кожен байт перетворився на 2 байти UTF-8. Тож після
# read_text(utf-8) маємо рядок типу "ð\x9f\x92\x96" замість "💖". Ключі словника
# будуємо тим самим перетворенням, щоб збігалось.
_EMOJI_REAL = {
    "💖": "1f496", "👍": "1f44d", "🎉": "1f389", "👏": "1f44f", "😂": "1f602",
    "😮": "1f62e", "😢": "1f622", "🤔": "1f914", "👎": "1f44e", "🍆": "1f346",
}
EMOJI_CODEPOINTS = {
    e.encode("utf-8").decode("latin1"): code for e, code in _EMOJI_REAL.items()
}


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

    # Emoji-кнопки реакцій: cleanup замінив усі fonts.gstatic.com PNG-и на
    # placeholder.svg → видно ряд однакових сірих гуртків. Підміняємо src за
    # data-emoji на локальний PNG з noto-emoji.
    def _emoji_sub(m: re.Match) -> str:
        emoji = m.group("emoji")
        code = EMOJI_CODEPOINTS.get(emoji)
        if not code:
            return m.group(0)
        return f'{m.group("pre")}src="assets/img/emoji/{code}.png"{m.group("post")}'

    html = re.sub(
        r'(?P<pre><img\b[^>]*?\bdata-emoji="(?P<emoji>[^"]+)"[^>]*?\s)'
        r'src="[^"]*"'
        r'(?P<post>[^>]*?>)',
        _emoji_sub,
        html,
    )

    # Відносні шляхи в HTML (`assets/...`) при відкритті через /api/render
    # резолвились би відносно /api/ → 404 на шрифти/іконки. <base href="/">
    # змушує браузер брати їх від кореня — той самий ефект, що при сирому
    # index.html, але без переписування атрибутів.
    html = html.replace("<head>", '<head><base href="/">', 1)
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
                    "avatar IS NOT NULL AS has_avatar, avatar_mime, skipped, "
                    "user_added, position "
                    "FROM participants ORDER BY position"
                ))
            return self._json(200, [dict(r) for r in rows])

        if path.startswith("/api/avatar/"):
            did = unquote(path[len("/api/avatar/"):])
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
                    'attachment; filename="index.html"'
                )
            return self._text(200, "text/html; charset=utf-8", html, headers)

        if path == "/api/prompt":
            try:
                txt = PROMPT_FILE.read_text(encoding="utf-8")
            except FileNotFoundError:
                txt = ""
            return self._json(200, {"prompt": txt})

        if path == "/api/credits":
            api_key = get_setting("openrouter_api_key")
            if not api_key:
                return self._json(400, {"error": "API key не задано"})
            try:
                data = fetch_openrouter_credits(api_key)
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="replace")
                return self._json(e.code, {"error": f"HTTP {e.code}: {body}"})
            except Exception as e:  # noqa: BLE001
                return self._json(500, {"error": str(e)})
            return self._json(200, data)

        if path == "/api/generations":
            participant = (query.get("participant_id") or [None])[0]
            status = (query.get("status") or [None])[0]
            sql = (
                "SELECT id, participant_id, prompt, model, provider, service_tier, "
                "status, error, image IS NOT NULL AS has_image, image_mime, "
                "cost_usd, prompt_tokens, output_tokens, created_at, finished_at "
                "FROM generations WHERE 1=1"
            )
            args: list = []
            if participant:
                sql += " AND participant_id = ?"
                args.append(participant)
            if status:
                sql += " AND status = ?"
                args.append(status)
            sql += " ORDER BY id DESC LIMIT 200"
            with db() as con:
                rows = [dict(r) for r in con.execute(sql, args)]
            return self._json(200, rows)

        if path.startswith("/api/generation-image/"):
            try:
                gid = int(path[len("/api/generation-image/"):])
            except ValueError:
                return self._text(400, "text/plain", b"bad id")
            with db() as con:
                row = con.execute(
                    "SELECT image, image_mime FROM generations WHERE id = ?",
                    (gid,),
                ).fetchone()
            if not row or not row["image"]:
                return self._text(404, "text/plain", b"no image")
            return self._text(200, row["image_mime"], row["image"],
                              {"Cache-Control": "no-store"})

        # статика з ROOT
        return self._serve_file(path)

    def do_PUT(self):
        u = urlparse(self.path)
        if u.path == "/api/settings":
            body = self._read_json()
            updates = {k: v for k, v in body.items() if k in ALLOWED_SETTING_KEYS}
            if not updates:
                return self._json(400, {"error": "no allowed keys"})
            with db() as con:
                for k, v in updates.items():
                    # Порожній рядок для секретів = очистити.
                    val = "" if v is None else str(v)
                    con.execute(
                        "INSERT INTO settings(key, value) VALUES(?,?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (k, val),
                    )
            return self._json(200, {"ok": True})

        if u.path == "/api/prompt":
            body = self._read_json()
            txt = body.get("prompt", "")
            PROMPT_FILE.write_text(txt, encoding="utf-8")
            return self._json(200, {"ok": True})

        if u.path.startswith("/api/participants/"):
            did = unquote(u.path[len("/api/participants/"):])
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
                    try:
                        mime, blob = _parse_data_url(v)
                    except ValueError:
                        return self._json(400, {"error": "bad data URL"})
                    fields["avatar_mime"] = mime
                    fields["avatar"] = blob
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

    def do_POST(self):
        u = urlparse(self.path)

        if u.path == "/api/participants":
            body = self._read_json()
            name = (body.get("custom_name") or "").strip()
            if not name:
                return self._json(400, {"error": "custom_name required"})
            # Локальний ID для віртуального учасника — не зачіпає рендер
            # index.html (там тільки spaces/.../devices/NNN з фіксованого списку).
            did = f"local/{uuid.uuid4().hex[:12]}"
            with db() as con:
                row = con.execute("SELECT COALESCE(MAX(position), -1) AS m FROM participants").fetchone()
                pos = (row["m"] or 0) + 1
                con.execute(
                    "INSERT INTO participants(device_id, original_name, custom_name, "
                    "skipped, position, user_added) VALUES(?,?,?,0,?,1)",
                    (did, name, name, pos),
                )
            return self._json(200, {"device_id": did})

        if u.path == "/api/generate":
            body = self._read_json()
            pid = body.get("participant_id")
            prompt = (body.get("prompt") or "").strip()
            if not prompt:
                try:
                    prompt = PROMPT_FILE.read_text(encoding="utf-8").strip()
                except FileNotFoundError:
                    prompt = ""
            if not prompt:
                return self._json(400, {"error": "prompt порожній"})
            s = get_settings(include_secrets=True)
            if not s.get("openrouter_api_key"):
                return self._json(400, {"error": "OpenRouter API key не задано"})
            model = body.get("model") or s.get("gen_model") or DEFAULT_GEN_MODEL
            provider = body.get("provider") or s.get("gen_provider") or DEFAULT_GEN_PROVIDER
            tier = body.get("service_tier") or s.get("gen_tier") or DEFAULT_GEN_TIER
            with db() as con:
                cur = con.execute(
                    "INSERT INTO generations(participant_id, prompt, model, provider, service_tier) "
                    "VALUES(?,?,?,?,?)",
                    (pid, prompt, model, provider, tier),
                )
                gen_id = cur.lastrowid
            t = threading.Thread(target=_run_generation, args=(gen_id,), daemon=True)
            t.start()
            return self._json(200, {"id": gen_id})

        if u.path.startswith("/api/generations/") and u.path.endswith("/approve"):
            try:
                gid = int(u.path[len("/api/generations/"):-len("/approve")])
            except ValueError:
                return self._json(400, {"error": "bad id"})
            with db() as con:
                row = con.execute(
                    "SELECT participant_id, image, image_mime, status "
                    "FROM generations WHERE id = ?",
                    (gid,),
                ).fetchone()
                if not row:
                    return self._json(404, {"error": "not found"})
                if row["status"] != "done" or not row["image"]:
                    return self._json(400, {"error": "генерація ще не готова"})
                pid = row["participant_id"]
                if not pid:
                    return self._json(400, {"error": "генерація не привʼязана до учасника"})
                cur = con.execute(
                    "UPDATE participants SET avatar=?, avatar_mime=?, "
                    "updated_at=CURRENT_TIMESTAMP WHERE device_id=?",
                    (row["image"], row["image_mime"], pid),
                )
                if cur.rowcount == 0:
                    return self._json(404, {"error": "учасника не знайдено"})
                con.execute("DELETE FROM generations WHERE id = ?", (gid,))
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "no route"})

    def do_DELETE(self):
        u = urlparse(self.path)
        if u.path.startswith("/api/participants/"):
            did = unquote(u.path[len("/api/participants/"):])
            q = parse_qs(u.query)
            hard = q.get("hard", ["0"])[0] in ("1", "true")
            with db() as con:
                if hard:
                    # Видаляємо повністю — це безпечно лише для user_added,
                    # бо інакше при наступному старті init_db() повторно
                    # вставить дефолтний рядок.
                    row = con.execute(
                        "SELECT user_added FROM participants WHERE device_id = ?",
                        (did,),
                    ).fetchone()
                    if not row:
                        return self._json(404, {"error": "not found"})
                    if not row["user_added"]:
                        return self._json(400, {"error": "не можна видалити дефолтного учасника"})
                    con.execute("DELETE FROM participants WHERE device_id = ?", (did,))
                else:
                    con.execute(
                        "UPDATE participants SET custom_name=NULL, avatar=NULL, "
                        "avatar_mime=NULL, updated_at=CURRENT_TIMESTAMP "
                        "WHERE device_id = ?",
                        (did,),
                    )
            return self._json(200, {"ok": True})

        if u.path.startswith("/api/generations/"):
            try:
                gid = int(u.path[len("/api/generations/"):])
            except ValueError:
                return self._json(400, {"error": "bad id"})
            with db() as con:
                con.execute("DELETE FROM generations WHERE id = ?", (gid,))
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
