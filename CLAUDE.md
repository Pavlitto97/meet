# Meet editor — нотатки для AI

Локальний редактор збереженої сторінки Google Meet. Дозволяє вживляти у HTML
кастомні аватарки, імена учасників, час і код зустрічі. Все робиться **офлайн**
поверх одного HTML-файлу — без звертань до Google.

> Бекенд переписано з Python на **PHP** (стандартний PHP: pdo_sqlite + curl, без
> composer/фреймворків). `data.db`, REST API і фронтенд лишились ті самі —
> `/api/render` віддає байт-у-байт ідентичний результат.

## Структура проекту

```
index.html                    ← Збережена сторінка Meet (~2.8 MB, single line)
index.html.bak                ← Бекап оригіналу (повторюй із .bak якщо щось зламав)
editor.html                   ← Веб-редактор (UI), бере дані через REST
admin.html                    ← Адмін-панель (вкладки: огляд/учасники/генерації/...)
server.php                    ← Точка входу: `php server.php [--port N]` → піднімає php -S
router.php                    ← Front controller для вбудованого сервера (php -S … router.php)
meeteditor/                   ← Бекенд-пакет (namespace Meet; лише стандартний PHP)
  config.php                  ← Шляхи, константи, дефолти, список учасників, emoji-мапа
  state.php                   ← Рантайм-стан (порт, uptime) зі змінних середовища
  db.php                      ← PDO-підключення SQLite, схема, міграції, log_activity()
  settings.php                ← get/update settings (із приховуванням секретів)
  media.php                   ← data:URL ↔ blob, avatar_data_url()
  participants.php            ← CRUD учасників + reorder
  openrouter.php              ← Клієнт OpenRouter через curl (генерація зображень, баланс)
  generations.php             ← Черга AI-генерацій, апрув, регенерація, bulk-delete
  gen_worker.php              ← CLI-воркер фонової генерації (детачнутий процес)
  screenshots.php             ← Скріни рендеру через headless Chrome (proc_open) + історія
  render.php                  ← render_meet() — генерація Meet HTML
  admin.php                   ← Агрегати адмінки: stats/system/db/export/import/presets
  http.php                    ← Request/Response, роутер (метод+regex), serve_file
  routes.php                  ← Реєстрація всіх маршрутів (route())
  bootstrap.php               ← Завантажує весь пакет; піднімає pcre.backtrack_limit
data.db                       ← SQLite, створюється при першому запуску. У git не йде.
assets/                       ← Локалізовані шрифти/іконки/логотипи Meet
  css/app.css                 ← Стиль РЕДАКТОРА (editor.html)
  css/admin.css               ← Стиль АДМІНКИ (admin.html) — самодостатній, Material Design 3
                                у дусі Google Meet (фон #202124, акцент #8ab4f8, шрифт Roboto)
  js/api.js                   ← Спільні JS-утиліти (api(), splitCollage, тости…)
  js/editor.js                ← Логіка редактора
  js/admin.js                 ← Логіка адмін-панелі
  fonts/                      ← woff/woff2 (Roboto, Google Sans, Google Symbols)
  fonts/admin/                ← Roboto 400/500/700 (latin+cyrillic) для admin.css (офлайн)
  img/                        ← placeholder.svg + іконки Meet + emoji/
  vendor/flatpickr/           ← Пікер часу
cleanup.php                   ← Прибирає <script>, обробники onX, посилання на google.*
rewrite_html.php              ← Замінює google CDN-URL на локальні assets/
download_assets.sh            ← Тягне всі assets із Google CDN у assets/
old_index.html, old_script.js, old_styles.css ← Стара заготовка простого Meet-clone (не використовується)
```

## Як запускати

```bash
php server.php                 # порт 8000 (або змінна PORT)
php server.php --port 8123     # інший порт
# Редактор:     http://localhost:8000/editor.html
# Адмін-панель: http://localhost:8000/admin.html
```

`server.php` ініціалізує `data.db` і запускає вбудований веб-сервер PHP
(`php -S 127.0.0.1:<port> -t <root> router.php`) із `PHP_CLI_SERVER_WORKERS=4`.
**Кілька воркерів обовʼязкові для скрінів**: поки запит `/api/screenshots`
тримається, інший воркер віддає Chrome `/api/render` + assets. `router.php` —
front controller: на кожен запит диспетчеризує API-маршрути, решту (GET) віддає
як статику з кореня. БД ініціалізується один раз у `server.php`, не в router.

Залежності: лише розширення `pdo_sqlite` та `curl` (вбудовані в PHP). Без composer.

Логіка живе у пакеті `meeteditor/` (namespace `Meet`); `require_once` без циклів:
`config → state/db/media → settings/openrouter/render/participants/generations/
admin/screenshots → http → routes` (див. `bootstrap.php`).

## REST API (`meeteditor/routes.php`)

Маршрути реєструються `route(method, regex, handler)` у `routes.php`; кожен хендлер
тонкий — делегує у сервісний модуль. Хендлер повертає `Response` (бінарне/кастомне)
або асоціативний масив (→ JSON; ключ `_status` = HTTP-код помилки). `device_id` у
шляху — URL-кодований (`encodeURIComponent`), бо містить `/`; на сервері
`rawurldecode`.

**Учасники / рендер / налаштування:**

| Маршрут                                | Метод   | Опис                                                                              |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `/api/participants`                    | GET     | Список усіх учасників (без байтів — лише `has_avatar`/`has_avatar_end`).          |
| `/api/participants`                    | POST    | Додати віртуального учасника (`local/<hex>`, `user_added=1`).                     |
| `/api/participants/reorder`            | POST    | `{order:[device_id,…]}` → перезаписати `position`.                                |
| `/api/participants/<device_id>`        | PUT     | Оновити `custom_name`/`original_name`/`skipped`/`position`/`avatar(_end)_data_url`.|
| `/api/participants/<device_id>`        | DELETE  | Скинути правки; `?hard=1` — видалити рядок (лише для `user_added`).               |
| `/api/avatar/<device_id>?which=`       | GET     | Бінарний аватар (`start`\|`end`).                                                 |
| `/api/settings`                        | GET/PUT | `start_time/period`, `end_time/period`, `meeting_code`, `gen_*`, `openrouter_api_key` (секрет).|
| `/api/prompt`                          | GET/PUT | Текст `promt.md`.                                                                 |
| `/api/render?which=&download=`         | GET     | Згенерований Meet HTML (`start`\|`end`). `?download=1` → attachment.              |
| `/api/credits`                         | GET     | Баланс OpenRouter.                                                                |
| `/api/generate`                        | POST    | Поставити AI-генерацію у чергу (детачнутий `gen_worker.php`).                     |
| `/api/generations?participant_id=&status=` | GET | Список генерацій (+ім'я учасника, `has_image`).                                  |
| `/api/generation-image/<id>`           | GET     | Бінарне зображення генерації.                                                     |
| `/api/generations/<id>/approve`        | POST    | `{which:start\|end}` — прийняти цілу картинку як аватар.                          |
| `/api/generations/<id>`                | DELETE  | Видалити генерацію.                                                               |

**Адмінка:**

| Маршрут                                | Метод   | Опис                                                                              |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `/api/admin/stats`                     | GET     | Агрегати для дашборду (учасники, генерації, вартість за моделями, розмір БД).     |
| `/api/admin/system`                    | GET     | index.html/.bak статус+розмір, assets, **php**, порт, uptime, chrome.             |
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

**Скріни (headless Chrome):**

| Маршрут                                | Метод   | Опис                                                                              |
| -------------------------------------- | ------- | --------------------------------------------------------------------------------- |
| `/api/screenshots`                     | POST    | Зробити скрін рендеру: `{which:start\|end, width, height, label}` → запис у БД.    |
| `/api/screenshots?which=`              | GET     | Історія скрінів (без байтів — `has_image`, розмір, код зустрічі, мітка).          |
| `/api/screenshot-image/<id>?download=` | GET     | Бінарний PNG; `?download=1` → attachment.                                         |
| `/api/screenshots/bulk-delete`         | POST    | `{scope:start\|end\|all}`.                                                        |
| `/api/screenshots/<id>`                | DELETE  | Видалити один скрін.                                                              |

`/api/admin/system` додатково віддає `chrome:{available,path}` — чи знайдено
Chrome для скрінів. `/api/admin/stats` віддає `screenshots:{total,starts,ends,bytes}`.

`device_id` має формат `spaces/mBsECBRYcS4B/devices/127` — це той самий id, що
сидить в атрибуті `data-participant-id` у вихідному HTML.

## SQLite-схема (`data.db`)

```sql
participants (
  device_id       TEXT PRIMARY KEY,   -- "spaces/.../devices/127" або "local/<hex>"
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
screenshots (id, which, image BLOB, image_mime, width, height,
             meeting_code, label, size_bytes, created_at)  -- історія скрінів (PNG)
```

Дефолтні рядки сидять у `default_participants()` і `DEFAULT_SETTINGS` у
`meeteditor/config.php`. Міграції — лагідні `ALTER TABLE … ADD COLUMN`-стилю у
`db.php::init_db()`. Щоб скинути все — `rm data.db && php server.php` **або** кнопка
«Скинути базу» в адмінці (`/api/admin/db/reset`).

**BLOB-и в PDO:** аватарки/зображення біндяться як звичайні string-параметри
(`q($con, $sql, [$blob, …])`) — pdo_sqlite байт-безпечний (NUL-и зберігаються).
Цілі колонки повертаються як `int` (`ATTR_STRINGIFY_FETCHES=false`), тож
`has_avatar`/`has_image` приходять як `0/1`, а не `"0"/"1"`.

## Mojibake-імена (`config.php`)

Тексти імен у HTML — UTF-8 байти, інтерпретовані як Latin-1 codepoints
(`Ð¡Ð°Ð½Ñ` замість `Саня`). Це навмисне: збережена сторінка така. `original_name`
у БД має збігатися з HTML **байт-у-байт**, щоб заміна `str_replace` спрацювала.

Дефолти будуються через `latin1_to_utf8($s)` — кодує кожен байт як `U+00xx`:
`latin1_to_utf8('Дима')` → ті самі байти, що в HTML. **Виняток**: імена на «я»
(Саня/Ваня/Даня) — у збереженій сторінці загубився останній байт `0x8F`
(C1-control), тож pre-image для них `"Сан\xD1"`, а не `"Саня"` (інакше байти не
збіжаться). `custom_name` тримає коректне відображуване ім'я.

Той самий трюк для emoji-мапи (`emoji_codepoints()`): `data-emoji` у HTML —
double-encoded, ключі будуються `latin1_to_utf8('💖')`.

## Як працює рендер (`meeteditor/render.php::render_meet`)

Текстова заміна по сирому HTML **байтами** (PHP-рядок = байти; regex без `/u`) —
НЕ DOM-парсинг. `index.html` недоторканий, усе в пам'яті.

1. Читає `index.html` з диска.
2. Збирає байтові офсети **всіх** `data-participant-id="..."` (`preg_match_all`
   з `PREG_OFFSET_CAPTURE`). Між двома сусідніми — DOM-підграф однієї плитки.
3. Для кожного учасника з аватаркою: у межах плитки знаходить усі
   `<img ... src="...">` і збирає правки `src` → `data:` URI.
4. Правки сортуються за спаданням позиції і застосовуються (`substr`-splice) —
   щоб офсети не зсувались.
5. Імена замінюються **глобально** (`str_replace`) — людина зʼявляється і в
   плитці, і в банері «Presenting», і в листі учасників. Сортуємо за спаданням
   довжини оригіналу, щоб короткі підрядки не псували довші.
6. Налаштування зустрічі:
   - `meeting_code` — глобальна `str_replace("yrt-kczi-csw", new)`.
   - `time`/`period` — точкові `preg_replace_callback` (limit 1) всередині
     відомих `<span jsname="W5i7Bf">`/`<span jsname="d1rraf">`.
7. Emoji — `preg_replace_callback` за `data-emoji` → локальний PNG з noto-emoji.
8. У `<head>` вживляється `<base href="/">` + override-стилі (розтягнути
   кастомне `data:`-фото на весь розмір плитки `.oZRSLe`).

`ORIGINAL_MEETING_CODE`, `ORIGINAL_TIME`, `ORIGINAL_PERIOD` — захардкоджені
константи **оригінального** значення у HTML (що саме шукати для заміни).

> **PCRE-ліміт:** після вживлення multi-MB base64 `data:`-URL рядок розростається
> до ~8 MB, і emoji-regex вичерпує дефолтний `pcre.backtrack_limit` (1M)
> («Backtrack limit exhausted» → `preg_*` повертає null). `bootstrap.php` піднімає
> `pcre.backtrack_limit`/`pcre.recursion_limit` до 1e9. Python-`re` цього ліміту
> не мав.

## Як працюють скріни (`meeteditor/screenshots.php`)

Скрін — растровий PNG того, що віддає `/api/render`. Робиться через **headless
Chrome** (без pip/composer — лише вже встановлений браузер):

1. `find_chrome()`: `CHROME_BIN` з оточення → типові macOS-шляхи → PATH. Нема
   Chrome → `capture()` повертає 503.
2. Chrome відкриває **живий URL** `http://127.0.0.1:PORT/api/render?which=…`, а
   НЕ `file://` — бо рендер має `<base href="/">`. `state\port()` дає порт (зі
   змінної середовища `MEET_PORT`, яку виставив `server.php`). Запити Chrome
   обслуговує **інший воркер** php -S (тому `PHP_CLI_SERVER_WORKERS>1`).
3. **Чому proc_open + опитування файлу**: сучасний Chrome пише `--screenshot` на
   диск, але САМ НЕ ВИХОДИТЬ. Тож `proc_open` (масив-команда → без shell),
   опитуємо вихідний PNG поки розмір не стабілізується (~0.2с), потім
   `proc_terminate` (SIGTERM→SIGKILL). Один скрін ≈ 3 с.
4. Розмір вікна (= PNG) приходить із UI (`1280×720`/`1920×1080`), клемпиться у
   `MIN/MAX_W/H`. `--force-device-scale-factor=1` → піксель-в-піксель.
5. PNG складається у таблицю `screenshots` (BLOB) → історія + завантаження.

## Фонова AI-генерація (`generations.php` + `gen_worker.php`)

`/api/generate` вставляє рядок `generations(status=pending)` і **детачить окремий
процес**: `exec("php meeteditor/gen_worker.php <id> > /dev/null 2>&1 &")` (аналог
daemon-потоку Python). Воркер `run_generation()`:
- читає рядок, бере `openrouter_api_key` з settings;
- викликає OpenRouter (`openrouter.php`, curl), ретраїть до 3 разів empty-image
  (HTTP-помилки 401/404/429 фейлить одразу);
- пише `status=done` + image/cost або `status=error` + повідомлення.

Кілька процесів пишуть у той самий `data.db` — `PRAGMA busy_timeout=5000` на
кожному підключенні гасить «database is locked».

## Особливості Meet HTML

- Один рядок ~2.8 MB, читати **тільки** через `Read` з `limit`/`offset` або
  `grep`/`php`. Прямий `cat` повісить термінал.
- Скрипти й посилання на `google.*`/`gstatic.*` уже зачищені скриптами
  `cleanup.php` + `rewrite_html.php`. `Google`/`google` у тексті замінено на
  `App`/`app`.
- Кожна плитка містить два `<img>`: `class="m0DVAf"` (схований через
  `.m0DVAf{display:none}`) і `class="SOQwsf"` (видимий, `object-fit:cover`).
  Заміна `src` обом — простіше і не залежить від того, котрий рендерить браузер.
- На сторінці 9 учасників-плиток + презентерський банер (`devices/140`):
  - editable: 127 (Sandro), 129 (Саня), 131 (Ваня), 132 (Даня), 133 (Дима),
    134 (Микита), 135 (Микола)
  - skipped (показуємо як placeholder силуети): 126 (Pavlo Grinevich) і
    136/137/138 — учасники, що злиплись у плитку «3 others».

## Робочі патерни

- **Змінити дефолти учасників** → редагувати `default_participants()` у
  `meeteditor/config.php`, видалити `data.db`, перезапустити сервер.
- **Дані псуються при рендері** — перш ніж копати у `render.php`, відкоти
  `index.html` з `.bak` (вручну або кнопкою «Відновити index.html» в адмінці).
- **Безпека шляхів**: `http.php::serve_file` обмежений `ROOT` через `realpath`
  + перевірку префікса. Не приймає `..` поза кореня.
- **Додати маршрут**: новий `route("GET", '/api/…', fn($r)=>…)` у `routes.php`,
  делегуй у сервісний модуль. Бінарну відповідь — `new Response(...)`, JSON —
  повертай масив.
- **Великі бінарні аватарки**: зберігаються як BLOB у SQLite. Якщо `data.db`
  розросте — `VACUUM` (кнопка в адмінці).
- Editor і адмінка зберігають правки **одразу** після кожної зміни поля
  (через `change` event). Кнопка «Переглянути» відкриває `/api/render`.
- **Адмінка** (`admin.html` + `assets/js/admin.js`) — вкладки: огляд, учасники,
  генерації, скріни, налаштування, промт+пресети, система.
- **Зробити скрін у коді** → `screenshots\capture(which, w, h)`. Залежить від
  встановленого Chrome (`screenshots\chrome_available()`).

## Що залишається на майбутнє

- Підтримка «3 others» — якщо знадобиться розгорнути групу і дати кожному фото.
- Інтернаціоналізація — зараз тексти UI тільки українські.
- Drag-and-drop reorder (зараз — стрілки ↑↓ в адмінці).

## Конвенції

- Сервер — **стандартний PHP** (pdo_sqlite + curl), без composer і фреймворків.
  Не додавай Laravel/Symfony/тощо без явного запиту користувача.
- Бекенд — пакет `meeteditor/` (namespace `Meet`); `server.php`/`router.php`
  лишаються тонкими. Нову логіку клади у відповідний модуль.
- Frontend — нативний HTML/JS, без фреймворків і бандлерів. Спільні утиліти —
  `assets/js/api.js`. Стилі РОЗДІЛЕНІ: редактор — `assets/css/app.css`, адмінка —
  `assets/css/admin.css` (самодостатній; правки адмінки не чіпають редактор і навпаки).
  Адмінка витримана в стилі **Google Meet / Material Design** (темна тема Meet —
  `#202124` + `#8ab4f8`, шрифт Roboto). Тримайся цього стилю; не вигадуй нову естетику.
- Імена/код зустрічі/час — текстова заміна, не DOM-парсинг. DOMParser
  перепаковує атрибути і втрачає особливості Meet markup.
- Зміни у `index.html` НІКОЛИ не пишуться напряму під час рендеру — лише
  в пам'яті через `/api/render`. **Виняток**: явна адмін-дія «Відновити з .bak»
  (`/api/admin/restore-index`, потребує `confirm:"RESTORE"`) перезаписує
  `index.html` копією `.bak` — це recovery, не рендер.
