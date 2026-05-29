"""Генерація Meet HTML із застосованими правками (аватарки, імена, час, код, emoji).

Текстова заміна по сирому HTML — НЕ DOM-парсинг: DOMParser перепаковує атрибути і
втрачає особливості Meet markup. index.html недоторканий — усе тільки в пам'яті.
"""
import re
from base64 import b64encode

from . import config
from .db import db
from .settings import get_settings


def render_meet(which: str = "start") -> str:
    """Малює Meet HTML. `which` обирає, яку «версію» рендеру повертати:
    - "start" (default): start_time / start_period, поле avatar
    - "end":             end_time   / end_period,   поле avatar_end (fallback на avatar)
    """
    if which not in ("start", "end"):
        which = "start"
    html = config.MEET_HTML.read_text(encoding="utf-8")
    occ = [(m.start(), m.end(), m.group(1))
           for m in re.finditer(r'data-participant-id="([^"]+)"', html)]

    with db() as con:
        rows = {r["device_id"]: r for r in con.execute(
            "SELECT device_id, original_name, custom_name, avatar, avatar_mime, "
            "avatar_end, avatar_end_mime FROM participants"
        )}

    img_re = re.compile(r'<img\b[^>]*?\ssrc="([^"]*)"')
    edits = []  # (start, end, replacement)

    for i, (pos_start, pos_end, pid) in enumerate(occ):
        row = rows.get(pid)
        if not row:
            continue
        bound = occ[i + 1][0] if i + 1 < len(occ) else len(html)
        tile = html[pos_end:bound]

        # Аватарка — обираємо за which, з фолбеком на avatar якщо end ще не задано.
        if which == "end" and row["avatar_end"]:
            blob, mime = row["avatar_end"], row["avatar_end_mime"]
        else:
            blob, mime = row["avatar"], row["avatar_mime"]
        # mime теж потрібен — без нього вийде невалідний "data:None;base64,…".
        if blob and mime:
            data_url = f"data:{mime};base64,{b64encode(blob).decode()}"
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
    new_code = (s.get("meeting_code") or config.ORIGINAL_MEETING_CODE).strip()
    if new_code and new_code != config.ORIGINAL_MEETING_CODE:
        html = html.replace(config.ORIGINAL_MEETING_CODE, new_code)
    # Час — точкові заміни всередині відомих span-ів. Беремо start_/end_
    # залежно від which.
    time_key = "end_time" if which == "end" else "start_time"
    period_key = "end_period" if which == "end" else "start_period"
    new_time = (s.get(time_key) or config.ORIGINAL_TIME).strip()
    if new_time and new_time != config.ORIGINAL_TIME:
        html = re.sub(
            r'(<span jsname="W5i7Bf">)' + re.escape(config.ORIGINAL_TIME) + r'(</span>)',
            lambda m: m.group(1) + new_time + m.group(2),
            html, count=1,
        )
    new_period = (s.get(period_key) or config.ORIGINAL_PERIOD).strip()
    if new_period and new_period != config.ORIGINAL_PERIOD:
        html = re.sub(
            r'(<span jsname="d1rraf"[^>]*>)' + re.escape(config.ORIGINAL_PERIOD) + r'(</span>)',
            lambda m: m.group(1) + new_period + m.group(2),
            html, count=1,
        )

    # Emoji-кнопки реакцій: cleanup замінив усі fonts.gstatic.com PNG-и на
    # placeholder.svg → видно ряд однакових сірих гуртків. Підміняємо src за
    # data-emoji на локальний PNG з noto-emoji.
    def _emoji_sub(m: re.Match) -> str:
        emoji = m.group("emoji")
        code = config.EMOJI_CODEPOINTS.get(emoji)
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
    #
    # Override-стилі: Meet рендерить аватарку як маленьке коло у центрі плитки
    # (це його placeholder для «камера вимкнена»). Нам треба видавати фото за
    # «увімкнену камеру» — розтягнути img на весь розмір плитки.
    head_inject = (
        '<base href="/">'
        '<style>'
        # Override застосовуємо ЛИШЕ для плиток з кастомним data:base64 фото.
        # Для учасників без аватара лишаємо дефолтну поведінку Meet
        # (m0DVAf сховано, SOQwsf — кругленький силует-placeholder).
        '.oZRSLe:has(img.m0DVAf[src^="data:"]){position:relative!important;}'
        '.oZRSLe img.m0DVAf[src^="data:"]{'
        'position:absolute!important;inset:0!important;'
        'width:100%!important;height:100%!important;'
        'object-fit:cover!important;border-radius:inherit!important;'
        'display:block!important;clip-path:none!important;z-index:5!important;}'
        # SOQwsf-кружечок ховаємо лише коли поверх нього лягло наше фото.
        '.oZRSLe:has(img.m0DVAf[src^="data:"]) img.SOQwsf{display:none!important;}'
        '</style>'
    )
    html = html.replace("<head>", "<head>" + head_inject, 1)
    return html
