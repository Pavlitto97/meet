# Meet editor — нотатки для AI

Локальний редактор збереженої сторінки Google Meet. Дозволяє вживляти у HTML
кастомні аватарки, імена учасників, час і код зустрічі. Все робиться **офлайн**
поверх одного HTML-файлу — без звертань до Google.

## Структура проекту

```
index.html                    ← Збережена сторінка Meet (~1.3 MB, single line)
index.html.bak                ← Бекап оригіналу (повторюй із .bak якщо щось зламав)
editor.html                   ← Веб-редактор (UI), бере дані через REST
admin.html                    ← Адмін-панель (вкладки: огляд/учасники/генерації/...)
server.py                     ← ТОНКИЙ шим: `from meeteditor.app import main`
server.py.orig.bak            ← Старий монолітний server.py (довідка, не використовується)
meeteditor/                   ← Бекенд-пакет (тільки stdlib, без залежностей)
  config.py                   ← Шляхи, константи, дефолти, список учасників, emoji-мапа
  state.py                    ← Рантайм-стан (uptime, порт) без циклів імпорту
  db.py                       ← Підключення SQLite, схема, міграції, log_activity()
  settings.py                 ← get/update settings (із приховуванням секретів)
  media.py                    ← data:URL ↔ blob, avatar_data_url()
  participants.py             ← CRUD учасників + reorder
  openrouter.py               ← Клієнт OpenRouter (генерація зображень, баланс)
  generations.py              ← Черга AI-генерацій, апрув, регенерація, bulk-delete
  render.py                   ← render_meet() — генерація Meet HTML
  admin.py                    ← Агрегати адмінки: stats/system/db/export/import/presets
  httpio.py                   ← Request/Response + BaseHTTPRequestHandler-міст
  router.py                   ← Мінімальний роутер (метод+regex → хендлер)
  routes.py                   ← Реєстрація всіх маршрутів (@route)
  app.py                      ← Точка входу: argparse --port, init_db, serve
data.db                       ← SQLite, створюється при першому запуску. У git не йде.
assets/                       ← Локалізовані шрифти/іконки/логотипи Meet
  css/app.css                 ← Спільний стиль редактора й адмінки
  js/api.js                   ← Спільні JS-утиліти (api(), splitCollage, тости…)
  js/editor.js                ← Логіка редактора
  js/admin.js                 ← Логіка адмін-панелі
  fonts/                      ← woff/woff2 (Roboto, Google Sans, Google Symbols)
  img/                        ← placeholder.svg + іконки Meet + emoji/
  vendor/flatpickr/           ← Пікер часу
cleanup.py                    ← Прибирає <script>, обробники onX, посилання на google.*
rewrite_html.py               ← Замінює google CDN-URL на локальні assets/
download_assets.sh            ← Тягне всі assets із Google CDN у assets/
old_index.html, old_script.js, old_styles.css ← Стара заготовка простого Meet-clone (не використовується редактором, залишена для довідки)
```

## Як запускати

```bash
python3 server.py                 # порт 8000 (або змінна PORT)
python3 server.py --port 8123     # інший порт
# Редактор:     http://localhost:8000/editor.html
# Адмін-панель: http://localhost:8000/admin.html
```

Сервер слухає `127.0.0.1:<port>`, віддає `editor.html` за замовчуванням, статику з
кореня проекту і REST API (див. нижче). База `data.db` створюється
автоматично з 11 учасниками і дефолтними settings.

Логіка живе у пакеті `meeteditor/`; `server.py` — тонкий шим заради звичного
`python3 server.py`. Імпорти модулів без циклів:
`config → db/media → settings/openrouter/render/participants/generations/admin →
routes → httpio/router → app`.

## REST API (`meeteditor/routes.py`)

Маршрути реєструються декоратором `@route(method, regex)` у `routes.py`; кожен
хендлер тонкий — делегує у сервісний модуль. Хендлер повертає `Response` або
`dict` (із `_status` для кодів помилок). `device_id` у шляху — URL-кодований
(`encodeURIComponent`), бо містить `/`.

**Учасники / рендер / налаштування (були й раніше, поведінка збережена):**

| Маршрут                                | Метод   | Опис                                                                              |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `/api/participants`                    | GET     | Список усіх учасників (без байтів — лише `has_avatar`/`has_avatar_end`).          |
| `/api/participants`                    | POST    | Додати віртуального учасника (`local/<uuid>`, `user_added=1`).                    |
| `/api/participants/reorder`            | POST    | `{order:[device_id,…]}` → перезаписати `position`.                                |
| `/api/participants/<device_id>`        | PUT     | Оновити `custom_name`/`original_name`/`skipped`/`position`/`avatar(_end)_data_url`.|
| `/api/participants/<device_id>`        | DELETE  | Скинути правки; `?hard=1` — видалити рядок (лише для `user_added`).               |
| `/api/avatar/<device_id>?which=`       | GET     | Бінарний аватар (`start`\|`end`).                                                 |
| `/api/settings`                        | GET/PUT | `start_time/period`, `end_time/period`, `meeting_code`, `gen_*`, `openrouter_api_key` (секрет).|
| `/api/prompt`                          | GET/PUT | Текст `promt.md`.                                                                 |
| `/api/render?which=&download=`         | GET     | Згенерований Meet HTML (`start`\|`end`). `?download=1` → attachment.              |
| `/api/credits`                         | GET     | Баланс OpenRouter.                                                                |
| `/api/generate`                        | POST    | Поставити AI-генерацію у чергу (фоновий потік).                                   |
| `/api/generations?participant_id=&status=` | GET | Список генерацій (+ім'я учасника, `has_image`).                                  |
| `/api/generation-image/<id>`           | GET     | Бінарне зображення генерації.                                                     |
| `/api/generations/<id>/approve`        | POST    | `{which:start\|end}` — прийняти цілу картинку як аватар.                          |
| `/api/generations/<id>`                | DELETE  | Видалити генерацію.                                                               |

**Нове в адмінці:**

| Маршрут                                | Метод   | Опис                                                                              |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `/api/admin/stats`                     | GET     | Агрегати для дашборду (учасники, генерації, вартість за моделями, розмір БД).     |
| `/api/admin/system`                    | GET     | index.html/.bak статус+розмір, assets, python, порт, uptime.                      |
| `/api/admin/db`                        | GET     | Кількість рядків по таблицях, розмір, page_count/freelist.                        |
| `/api/admin/db/vacuum`                 | POST    | `VACUUM`.                                                                          |
| `/api/admin/db/reset`                  | POST    | Скинути БД до дефолтів. Потрібен `{confirm:"RESET"}`.                             |
| `/api/admin/restore-index`             | POST    | Відновити `index.html` з `.bak`. Потрібен `{confirm:"RESTORE"}`.                  |
| `/api/admin/export?download=`          | GET     | Повний знімок стану (учасники з аватарками, settings без секретів, промт, пресети).|
| `/api/admin/import`                    | POST    | Застосувати знімок (учасники — за `device_id`, нові `local/*` створюються).       |
| `/api/admin/backup`                    | GET     | Завантажити `data.db` як файл.                                                    |
| `/api/admin/activity?limit=`           | GET     | Журнал останніх дій.                                                              |
| `/api/generations/<id>/regenerate`     | POST    | Повторити генерацію з тими ж параметрами.                                         |
| `/api/generations/bulk-delete`         | POST    | `{scope:error\|done\|pending\|all}`.                                              |
| `/api/prompt/presets`                  | GET/POST| Список / зберегти іменований промт-пресет.                                        |
| `/api/prompt/presets/<id>`             | DELETE  | Видалити пресет.                                                                  |

`device_id` має формат `spaces/mBsECBRYcS4B/devices/127` — це той самий id, що
сидить в атрибуті `data-participant-id` у вихідному HTML.

## SQLite-схема (`data.db`)

```sql
participants (
  device_id       TEXT PRIMARY KEY,   -- "spaces/.../devices/127" або "local/<uuid>"
  original_name   TEXT NOT NULL,      -- ім'я як воно записане у HTML (часто mojibake)
  custom_name     TEXT,               -- введене у редакторі. NULL = без заміни
  avatar          BLOB,               -- байти аватарки «початок»
  avatar_mime     TEXT,               -- "image/jpeg" і т.п.
  avatar_end      BLOB,               -- байти аватарки «кінець» (для split-колажа)
  avatar_end_mime TEXT,
  skipped         INTEGER NOT NULL DEFAULT 0,  -- 1 = не показувати в UI (Pavlo, "3 others")
  position        INTEGER NOT NULL,   -- порядок у редакторі/рендері
  user_added      INTEGER NOT NULL DEFAULT 0,  -- 1 = доданий вручну (можна hard-delete)
  updated_at      TEXT
)

settings (
  key   TEXT PRIMARY KEY,             -- 'start_time'|'start_period'|'end_time'|'end_period'|
  value TEXT                          --   'meeting_code'|'gen_model'|'gen_provider'|'gen_tier'|'openrouter_api_key'
)

generations (id, participant_id, prompt, model, provider, service_tier,
             status, error, image BLOB, image_mime, cost_usd, prompt_tokens,
             output_tokens, created_at, finished_at)
prompt_presets (id, name UNIQUE, body, created_at, updated_at)  -- іменовані промти
activity (id, ts, action, detail)  -- журнал дій (тримається ≤500 останніх)
```

Дефолтні рядки сидять у `PARTICIPANTS` і `DEFAULT_SETTINGS` у `meeteditor/config.py`.
Міграції — лагідні `ALTER TABLE … IF NOT EXISTS`-стилю у `db.init_db()`.
Щоб скинути все — `rm data.db && python3 server.py` **або** кнопка «Скинути базу»
в адмінці (`/api/admin/db/reset`).

## Як працює рендер (`meeteditor/render.py:render_meet`)

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
  оригінальне ім’я) → редагувати `PARTICIPANTS` у `meeteditor/config.py`,
  видалити `data.db`, перезапустити сервер.
- **Дані псуються при рендері** — перш ніж копати у `render.py`, відкоти
  `index.html` з `.bak` (вручну або кнопкою «Відновити index.html» в адмінці).
- **Безпека шляхів**: `httpio.serve_file` обмежений `ROOT` через
  `target.relative_to(ROOT.resolve())`. Не приймає `..` поза кореня.
- **Додати маршрут**: новий `@route("GET", r"/api/…")` у `routes.py`, делегуй у
  сервісний модуль. Бінарну відповідь — через `Response(...)`, JSON — повертай dict.
- **Великі бінарні аватарки**: зберігаються як BLOB у SQLite. Якщо `data.db`
  розросте — `VACUUM` (кнопка в адмінці) стискає.
- Editor і адмінка зберігають правки **одразу** після кожної зміни поля
  (через `change` event). Кнопка «Переглянути» відкриває `/api/render`.
- **Адмінка** (`admin.html` + `assets/js/admin.js`) — вкладки: огляд (статистика),
  учасники (таблиця з reorder/skip/inline-edit/аватарки/генерація), генерації
  (галерея + апрув/розріз/повтор/bulk-delete), налаштування, промт+пресети,
  система (інфо/БД/експорт-імпорт/бекап/небезпечна зона/журнал).

## Що залишається на майбутнє

- Підтримка «3 others» — якщо знадобиться розгорнути групу і дати кожному фото.
- Інтернаціоналізація — зараз тексти UI тільки українські.
- Drag-and-drop reorder (зараз — стрілки ↑↓ в адмінці).

## Конвенції

- Сервер — стандартна бібліотека Python, **без зовнішніх залежностей**.
  Не додавай Flask/FastAPI/тощо без явного запиту користувача.
- Бекенд — пакет `meeteditor/`; `server.py` лишається тонким шимом. Нову логіку
  клади у відповідний модуль, не назад у `server.py`.
- Frontend — нативний HTML/JS, без фреймворків і бандлерів. Спільні утиліти —
  `assets/js/api.js`; стиль — `assets/css/app.css` (один на редактор+адмінку).
- Імена/код зустрічі/час — текстова заміна, не DOM-парсинг. DOMParser
  перепаковує атрибути і втрачає особливості Meet markup.
- Зміни у `index.html` НІКОЛИ не пишуться напряму під час рендеру — лише
  в пам’яті через `/api/render`. **Виняток**: явна адмін-дія «Відновити з .bak»
  (`/api/admin/restore-index`, потребує `confirm:"RESTORE"`) перезаписує
  `index.html` копією `.bak` — це recovery, не рендер.
