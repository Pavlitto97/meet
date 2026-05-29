"""Шляхи, константи та дефолтні дані проєкту.

Тут немає логіки — лише значення, які раніше жили зверху `server.py`. Жодних
імпортів із решти пакета, щоб не було циклів: усі модулі тягнуть `config`.
"""
import os
from pathlib import Path

# ─── Шляхи ───────────────────────────────────────────────────────────────────
# config.py лежить у meeteditor/, тому корінь проєкту — на рівень вище.
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data.db"
MEET_HTML = ROOT / "index.html"
MEET_HTML_BAK = ROOT / "index.html.bak"
PROMPT_FILE = ROOT / "promt.md"
ENV_FILE = ROOT / ".env"

# Порт можна задати через змінну середовища PORT або прапорець --port (див. app.py).
DEFAULT_PORT = int(os.environ.get("PORT", "8000"))
HOST = "127.0.0.1"

# ─── OpenRouter ────────────────────────────────────────────────────────────────
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits"
DEFAULT_GEN_MODEL = "google/gemini-2.5-flash-image"
DEFAULT_GEN_PROVIDER = "google-ai-studio"
DEFAULT_GEN_TIER = "default"

# ─── Дефолтні учасники ─────────────────────────────────────────────────────────
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

# ─── Дефолтні налаштування ───────────────────────────────────────────────────────
DEFAULT_SETTINGS = {
    # Час «початку» і «кінця» зустрічі — підставляються у footer Meet HTML.
    # Зустріч у Meet HTML має один таймер, ми малюємо ДВА рендери: один для
    # моменту on-start, інший для on-end (з різними аватарками, якщо є split).
    "start_time":         "10:34",
    "start_period":       "PM",
    "end_time":           "11:15",
    "end_period":         "PM",
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

# ─── Початкові значення у HTML (що саме шукати для заміни) ───────────────────────
ORIGINAL_MEETING_CODE = "yrt-kczi-csw"
ORIGINAL_TIME = "10:34"
ORIGINAL_PERIOD = "PM"

# ─── Emoji у нижньому реакц-тулбарі ──────────────────────────────────────────────
# cleanup/rewrite зачистили оригінальні fonts.gstatic.com URL і поставили
# placeholder.svg для всіх <img class="iiJ4W">. Тут мапимо data-emoji на локальні
# PNG з noto-emoji у assets/img/emoji/.
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

# MIME за розширенням — для статики.
STATIC_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".woff": "font/woff", ".woff2": "font/woff2",
    ".json": "application/json; charset=utf-8",
}
