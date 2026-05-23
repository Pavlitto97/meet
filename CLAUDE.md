# Meet editor — нотатки для AI

Локальний редактор збереженої сторінки Google Meet. Дозволяє вживляти у HTML
кастомні аватарки, імена учасників, час і код зустрічі. Все робиться **офлайн**
поверх одного HTML-файлу — без звертань до Google.

## Структура проекту

```
index.html                    ← Збережена сторінка Meet (~1.3 MB, single line)
index.html.bak                ← Бекап оригіналу (повторюй із .bak якщо щось зламав)
editor.html                   ← Веб-редактор (UI), бере дані з server.py через REST
server.py                     ← stdlib HTTP-сервер + SQLite + рендер Meet HTML
data.db                       ← SQLite, створюється при першому запуску. У git не йде.
assets/                       ← Локалізовані шрифти/іконки/логотипи Meet
  fonts/                      ← woff/woff2 (Roboto, Google Sans, Google Symbols)
  img/                        ← placeholder.svg + іконки Meet
cleanup.py                    ← Прибирає <script>, обробники onX, посилання на google.*
rewrite_html.py               ← Замінює google CDN-URL на локальні assets/
download_assets.sh            ← Тягне всі assets із Google CDN у assets/
old_index.html, old_script.js, old_styles.css ← Стара заготовка простого Meet-clone (не використовується редактором, залишена для довідки)
```

## Як запускати

```bash
python3 server.py
# Відкрити: http://localhost:8000/editor.html
```

Сервер слухає `127.0.0.1:8000`, віддає `editor.html` за замовчуванням, статику з
кореня проекту і REST API (див. нижче). База `data.db` створюється
автоматично з 11 учасниками і дефолтними settings.

## REST API (server.py)

| Маршрут                                | Метод   | Опис                                                                              |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `/api/participants`                    | GET     | Список усіх учасників (без байтів аватарки — лише `has_avatar`).                  |
| `/api/participants/<device_id>`        | PUT     | Оновити `custom_name` та/або `avatar_data_url` (`data:image/...;base64,...`).     |
| `/api/participants/<device_id>`        | DELETE  | Скинути користувацькі ім’я + аватарку (НЕ видаляє рядок).                         |
| `/api/avatar/<device_id>`              | GET     | Бінарний аватар (image/...) — для прев’ю в редакторі.                             |
| `/api/settings`                        | GET/PUT | Кейс-валуни: `time`, `period` (AM/PM), `meeting_code`.                            |
| `/api/render`                          | GET     | Згенерований Meet HTML з застосованими правками. `?download=1` → як attachment.   |

`device_id` має формат `spaces/mBsECBRYcS4B/devices/127` — це той самий id, що
сидить в атрибуті `data-participant-id` у вихідному HTML.

## SQLite-схема (`data.db`)

```sql
participants (
  device_id     TEXT PRIMARY KEY,   -- "spaces/.../devices/127"
  original_name TEXT NOT NULL,      -- ім'я як воно записане у HTML (часто mojibake)
  custom_name   TEXT,               -- введене у редакторі. NULL = без заміни
  avatar        BLOB,               -- байти зображення
  avatar_mime   TEXT,               -- "image/jpeg" і т.п.
  skipped       INTEGER NOT NULL DEFAULT 0,  -- 1 = не показувати в UI (Pavlo, "3 others")
  position      INTEGER NOT NULL,   -- порядок у редакторі
  updated_at    TEXT
)

settings (
  key   TEXT PRIMARY KEY,           -- 'time' | 'period' | 'meeting_code'
  value TEXT
)
```

Дефолтні рядки сидять у `PARTICIPANTS` і `DEFAULT_SETTINGS` зверху `server.py`.
Щоб скинути все — `rm data.db && python3 server.py`.

## Як працює рендер (`server.py:render_meet`)

1. Читає `index.html` з диска (UTF-8).
2. Збирає позиції **всіх** `data-participant-id="..."` у файлі. Між двома сусідніми
   позиціями — DOM-підграф однієї плитки (тайл у сітці АБО запис у списку
   учасників: ID повторюються в обох секціях).
3. Для кожного учасника з аватаркою: у межах плитки знаходить всі
   `<img ... src="...">` і замінює значення `src` на `data:` URI.
4. Імена замінюються **глобально** по всьому HTML (`.replace(original, custom)`).
   Глобально — бо одна людина зʼявляється і в плитці, і в банері «Presenting,
   annotating», і в листі учасників. Оригінали зберігаються в БД рівно у тому
   вигляді, як у HTML (зокрема mojibake-байти), щоб заміна збігалася байт-в-байт.
5. Налаштування зустрічі:
   - `meeting_code` — глобальна `str.replace("yrt-kczi-csw", new_code)`. Зачіпає
     `<title>`, `data-meeting-title`, видимий лейбл, tooltip.
   - `time` — точкова заміна всередині `<span jsname="W5i7Bf">10:34</span>`.
   - `period` — точкова заміна всередині `<span jsname="d1rraf" ...>PM</span>`.
6. Усі edits зрізів сортуються за спаданням позиції і застосовуються — щоб
   індекси не зсувались під час підстановки.

`ORIGINAL_MEETING_CODE`, `ORIGINAL_TIME`, `ORIGINAL_PERIOD` — захардкоджені
константи **оригінального** значення у HTML (потрібні щоб знати, що саме
шукати для заміни, навіть якщо settings уже були змінені раніше).

## Особливості Meet HTML

- Один рядок ~1.3 MB, читати **тільки** через `Read` з `limit`/`offset` або
  `grep`/`python3`. Прямий `cat` повісить термінал.
- Початково 64 файли в репо. Шрифти і логотипи живуть у `assets/`.
- Скрипти й посилання на `google.*`/`gstatic.*` уже зачищені скриптами
  `cleanup.py` + `rewrite_html.py`. `Google`/`google` у тексті замінено на
  `App`/`app`.
- Кожна плитка містить два `<img>`: `class="m0DVAf"` (схований через
  `.m0DVAf{display:none}`) і `class="SOQwsf"` (видимий, `object-fit:cover`).
  Заміна `src` обом — простіше і не залежить від того, котрий рендерить браузер.
- На сторінці є 9 учасників-плиток + презентерський банер (`devices/140`):
  - editable: 127 (Sandro), 129 (Саня), 131 (Ваня), 132 (Даня), 133 (Дима),
    134 (Микита), 135 (Микола)
  - skipped (показуємо як placeholder силуети): 126 (Pavlo Grinevich — це
    «свій» юзер у звичайній зустрічі) і 136 / 137 / 138 — учасники, які
    злиплись у плитку «3 others».
- Тексти імен у HTML — UTF-8 байти, інтерпретовані як Latin-1 codepoints
  (mojibake: `Ð¡Ð°Ð½Ñ` замість `Саня`). Це навмисне: збережена сторінка така.
  Заміна імен дозволяє показати нормальні рядки замість «крякозябр».

## Робочі патерни

- **Змінити дефолти учасників** (наприклад, додати нового або поправити
  оригінальне ім’я) → редагувати `PARTICIPANTS` у `server.py`, видалити
  `data.db`, перезапустити сервер.
- **Дані псуються при рендері** — перш ніж копати у `render_meet`, відкоти
  `index.html` з `.bak`.
- **Безпека шляхів**: `_serve_file` обмежений `ROOT` через
  `target.relative_to(ROOT.resolve())`. Не приймає `..` поза кореня.
- **Великі бінарні аватарки**: зберігаються як BLOB у SQLite. Якщо `data.db`
  розросте — це нормально (фото вшиті як байти, без файлів на диску).
- Editor зберігає правки **одразу** після кожної зміни поля (через `change`
  event), нічого не треба «застосовувати» окремо. Кнопка «Переглянути»
  просто відкриває `/api/render` у новій вкладці.

## Що залишається на майбутнє

- Додати undo / reset для окремого учасника (зараз тільки повне очищення).
- Зміна порядку плиток.
- Підтримка «3 others» — якщо знадобиться розгорнути групу і дати кожному фото.
- Інтернаціоналізація — зараз тексти UI у редакторі тільки українські.

## Конвенції

- Сервер — стандартна бібліотека Python, **без зовнішніх залежностей**.
  Не додавай Flask/FastAPI/тощо без явного запиту користувача.
- Frontend — нативний HTML/JS, без фреймворків і бандлерів.
- Імена/код зустрічі/час — текстова заміна, не DOM-парсинг. DOMParser
  перепаковує атрибути і втрачає особливості Meet markup.
- Зміни у `index.html` НІКОЛИ не пишуться напряму — лише
  рендер у пам’яті через `/api/render`. Оригінал недоторканий.
