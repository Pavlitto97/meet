# Журнал змін — Meet Editor Desktop

> Тут документуються всі суттєві зміни проєкту: що зроблено, навіщо, які файли
> зачеплено і як це перевірено. Новий запис — зверху. Деталі архітектури — у
> [ARCHITECTURE.md](ARCHITECTURE.md), нотатки для AI — у `../CLAUDE.md`.

---

## 2026-06-11 — Локальні білди mac (arm64+x64) і Windows; sharp для Intel-маку

`dist/`: `Meet Editor-0.1.0-arm64.dmg/.zip` (Apple Silicon), `Meet Editor-0.1.0.dmg`
/`-mac.zip` (Intel), `Meet Editor-0.1.0-x64.exe` (NSIS) + blockmap/latest*.yml.
Усі — зі сплеш-прелоадером (запис нижче). Unsigned (mac identity:null — як і раніше).
- **Виправлено sharp для Intel-маку**: у node_modules не було
  `@img/sharp-darwin-x64` — x64-білд виходив із непрацюючим sharp (ламались
  approve/crop/resize). `npm install --os darwin --cpu x64` каже «up to date» і
  нічого не ставить, тож бінарники доставлено через `npm pack
  @img/sharp-darwin-x64@0.34.5 @img/sharp-libvips-darwin-x64@1.2.4` + розпакування
  tgz у `node_modules/@img/` (npm їх не трекає; після `npm ci` повторити).
  Перевірено: обидва .app і win-unpacked містять усі платформенні `@img/*` в
  `app.asar.unpacked`, `app-resources/` містить splash.html/png.

## 2026-06-11 — Сплеш-прелоадер при старті (мін. 3 с)

**Навіщо:** користувач хоче бачити фірмовий прелоадер перед появою головного
вікна замість порожнього вікна під час ініціалізації.

- **`resources/splash.html` + `resources/splash.png`** (нові): самодостатній
  сплеш у стилі Meet (картка #202124, кільце-акцент #8ab4f8, спінер) із
  портретом у колі. Портрет вирізано з наданого PNG (фон-«шахівниця» був
  запечений у пікселі) через macOS Vision person segmentation → чистий
  прозорий PNG 448×512. Їде у білд через наявне правило extraResources.
- **`src/main/index.ts`**: `createSplash()` — frameless/transparent вікно
  380×420, без preload, `sandbox:true`, вантажиться `loadFile` (file://, бо
  `app://` ще не зареєстровано). Головне вікно створюється прихованим
  (`show:false`) і показується, коли воно `ready-to-show` **і** сплеш провисів
  ≥ `SPLASH_MIN_MS` (3000 мс; на прохання користувача збільшено з 1 с), після
  чого сплеш знищується. Під E2E (`process.env.E2E`) сплеш вимкнено — Playwright
  чекає `firstWindow()`, і сплеш ламав би тести (та ж логіка, що й DevTools).
- **`src/main/services/paths.ts`**: `splashHtmlPath()` (dev — `resources/`,
  пакет — `process.resourcesPath/app-resources`).
- **Перевірено**: Playwright-запуск зібраного застосунку без E2E — перше вікно
  `file://...splash.html`, головне вікно стає видимим після мінімальної
  затримки, сплеш знищено (лишається 1 вікно); скріншоти сплеша і головного
  вікна переглянуто вручну.

## 2026-06-11 — Перший Windows-інсталер із зашитими кредами

Зібрано локально на macOS (`npx electron-builder --win --x64 --publish never`):
`dist/Meet Editor-0.1.0-x64.exe` (NSIS, 114 МБ, unsigned) + `latest.yml`/`.blockmap`.
- **Креди зашиті**: `.env` із `OPENROUTER_API_KEY` їде в `resources/.env`
  інсталяції (extraResources) — генерація працює одразу після встановлення.
  `GH_TOKEN` лишився порожнім (авто-оновлення вимкнене, поки нема релізів/токена).
- **Крос-збірка sharp**: перед білдом `npm install --force --os win32 --cpu x64 sharp`
  додає `@img/sharp-win32-x64` у node_modules (інакше на Windows sharp не
  завантажиться); пакет потрапляє в `app.asar.unpacked` (правило asarUnpack).
- Іконка поки дефолтна Electron (electron-builder попереджає; додати
  `build/icon.ico` за потреби).

## 2026-06-11 — Ручний кроп генерації (окремо «початок» і «кінець»)

**Навіщо:** модель інколи порушує промт і малює колаж з білими рамками та
підписами («Meeting Start/End») — автоматичне розрізання навпіл лишає їх у
аватарках. Тепер область можна виділити вручну і зрізати сміття.

- **UI** (`CropModal.vue`, новий): **клік по згенерованому зображенню** відкриває
  його кроп-в'юером (плюс кнопка «Кроп» на картці). Виділення створює сам
  користувач — стартового нема (підказка «Виділи область мишею»), кнопки
  підтвердження вимкнені, поки область не обрана. Інтерактив: малювання мишею,
  переміщення за середину, ресайз за кути; затемнення поза рамкою; пресети
  «Ліва/Права половина» (для високих колажів — «Верхня/Нижня») і «Все
  зображення»; лічильник розміру в пікселях оригіналу. Підтвердження — ряд
  «Це кроп для: [Початок зустрічі] [Кінець зустрічі]»: виділене застосовується
  ОКРЕМО для кожної аватарки; модалка не закривається — типовий сценарій:
  виділити ліве фото → «Початок» → виділити праве → «Кінець». Перегляд-модалка
  ImageModal для готових генерацій більше не використовується (вона лишилась
  для помилок/оригіналу).
- **API**: `POST /api/generations/<id>/crop {which: start|end, x, y, width, height}`
  (координати в пікселях оригіналу; клемп у межі, мінімум 8×8) —
  `generations.ts::cropGeneration`: sharp extract → resize під плитку → запис у
  `avatar`/`avatar_end`; генерація лишається в історії з `approved_at`
  (як у approve).
- **Фікс — осиротілі pending**: воркер генерації живе в main-процесі, тож
  після перезапуску додатку pending-картки висіли «в обробці» вічно. Тепер на
  старті `failOrphanedGenerations()` позначає їх error
  («Перервано перезапуском додатку — натисни „Повторити"»).
- **Фікс — participant_id "1.0"**: node:sqlite біндить JS-число як REAL, і в
  TEXT-колонці `generations.participant_id` числа осідали як `"1.0"` (JOIN-и
  рятувала type affinity, але URL-и/типи ламались). Виправлено: одноразова
  нормалізація в `initDb` (`"1.0"` → `"1"`), вставка біндить `String(pid)`,
  вибірка віддає `CAST(... AS INTEGER)` — назовні тепер завжди число.
- **Тести**: live-спека розширена кроп-кроком (пресет половини → «→ Початок» →
  toast). Повний UI-набір — 14/14 зелені. Кроп перевірено наживо через CDP у
  реальній сесії: малювання/ресайз/переміщення рамки, застосування обох сторін,
  бейдж «застосовано», аватарки читаються (200, ~7 КБ).

## 2026-06-11 — Фолбек провайдерів OpenRouter (обхід HTTP 429)

**Проблема:** генерації падали з `OpenRouterHttpError: HTTP 429 … google/gemini-2.5-flash-image
is temporarily rate-limited upstream … is_byok:false`. Провайдер `google-ai-studio`
ділить спільну квоту OpenRouter і впирається в rate-limit, а код **забороняв**
маршрутизацію на інший провайдер (`only:[provider], allow_fallbacks:false`) — тож
429 ставав фатальним. Тариф `flex` (дефолт) погіршував: він живе лише на цьому
ж rate-limited провайдері.

**Виправлення — ланцюжкова маршрутизація з фолбеком** (`generations.ts::routingChain`
+ `runGeneration`, `openrouter.ts::callImage` отримав параметр `allowFallbacks`):
генерація по черзі пробує маршрутизації, і на 429/5xx/несумісності тарифу одразу
переходить до наступної, а не довбить ту саму квоту:
1. **як налаштовано** (напр. `flex` на обраному провайдері) — дешево, якщо доступно;
2. **той самий провайдер, тариф `default`**, з дозволеним фолбеком OpenRouter;
3. **будь-який провайдер** (provider не пінимо — OpenRouter сам обере найдоступніший).

Деталі: `allow_fallbacks:true` віддає `{order:[provider], allow_fallbacks:true}`
(провайдер першим, але OR може перемкнутись); `401/403` (ключ/доступ) — кидаємо
одразу (фолбек не врятує); жорстка відмова моделі (refusal/content_filter) —
теж одразу. У лог `generation.done` пишеться `via=<provider>/<tier>`, через яку
маршрутизацію вдалось.

**Перевірено:** живий прогін з дефолтом `google-ai-studio`+`flex` (який віддає 429)
автоматично перемкнувся на робочу маршрутизацію і завершив повний цикл
(оригінал → генерація → застосувати → рендер → скріни) без оверрайдів.

## 2026-06-11 — Вшитий OpenRouter-ключ (персистить після білда)

- У `desktop/.env` вписано робочий `OPENROUTER_API_KEY` (рішення проєкту —
  креди в приватному репо). Механізм персистентності: `.env` бандлиться в
  білд як extraResources (`electron-builder.yml` → `to: .env`); на старті
  `dotenv` читає його (`paths.ts::envPath`: packaged → `process.resourcesPath/.env`),
  а `db.ts::initDb` **upsert-ить** `OPENROUTER_API_KEY` із env у
  `settings.openrouter_api_key` при **кожному** запуску — тож ключ є і після
  збірки, і навіть якщо користувач його стер у БД.
- Перевірено: чистий запуск (ключ лише у `.env`, не в env шелла) →
  `openrouter_api_key_set=true`, `GET /api/credits` → 200.

## 2026-06-11 — Групи учасників, source-зображення, чистка UI

Великий редизайн: проєкт офіційно орієнтується на **Electron (macOS + Windows)**
як головний стек; PHP-версія в корені репозиторію лишається як референс.

### Нове: групи учасників

Тепер можна вести **кілька іменованих складів учасників** (наприклад, 10 груп),
кожен зі своїми фото та генераціями, і швидко перемикатися між ними.

- Таблиця `groups (id, name, created_at, updated_at)`.
- `participants` перебудовано: числовий `id` (PRIMARY KEY) замість `device_id`,
  додано `group_id` (FK → groups, `ON DELETE CASCADE`) і `UNIQUE(group_id, device_id)`.
  Кожна група отримує власні 11 слотів плиток збереженої сторінки Meet
  (сід `db.ts::seedGroupParticipants`, ідемпотентний `INSERT OR IGNORE`).
- **Активна група** (`settings.active_group_id`, самолікується на першу наявну):
  саме її учасники йдуть у `/api/render` і скріни. Явний оверрайд — `?group=N`.
- Остання група не видаляється; видалення групи зносить її учасників і генерації
  та (за потреби) переключає активну.
- **Міграція**: стара одногрупна БД (device_id PK) автоматично перебудовується
  у групову (`db.ts::migrateParticipantsToGroups`): створюється «Група 1»,
  учасники переносяться зі збереженням аватарів/імен/порядку,
  `generations.participant_id` перешивається з device_id на числовий id.
  Перевірено на синтетичній старій БД і на реальній dev-БД.

### Нове: source-зображення (оригінал)

- В учасника тепер **три зображення**: «Оригінал» (`source`/`source_mime`) —
  фото, яке завантажує користувач; «Початок» (`avatar`); «Кінець» (`avatar_end`).
- AI-генерація **завжди** йде з оригіналу (без нього `/api/generate` → 400 з
  підказкою). Знімок входу зберігається в `generations.input_image` — у картці
  генерації видно прев'ю «оригінал → результат».
- «Перегенерувати» бере **актуальний** source учасника (фолбек — знімок входу,
  якщо оригінал стерли).
- Source зберігається як завантажили; лише страховий downscale понад 1600 px
  по довшій стороні (`degrade.ts::normalizeSourceImage`) — щоб data:URL влазив
  у запит OpenRouter. Аватарки, як і раніше, зменшуються під плитку Meet.

### Змінено: застосування генерації (approve)

- Модель генерує один 16:9-колаж «початок|кінець» (промт `resources/promt.md`).
  Тепер **сервер** ріже його навпіл через sharp (широкий → ліво/право; високий
  h/w > 1.3 → верх/низ) і пише обидві аватарки одним кліком «Застосувати»
  (`POST /api/generations/<id>/approve {side: both|start|end}`).
- Генерація при цьому **не видаляється**: ставиться `approved_at` (єдина
  «застосована» на учасника, бейдж «застосовано») — історія лишається, щоб
  порівнювати старі й нові результати.
- Ретраї OpenRouter: транзієнтні 429/5xx тепер повторюються з наростаючим
  бекофом (5с×спроба, до 5 спроб) у `generations.ts::runGeneration`.

### Змінено: UI (Vue, Material Design 3 у стилі Meet)

- **Стартова вкладка — «Групи»**: картки груп з назвою, лічильниками
  (учасники/з фото/аватарки/генерації), бейджем «активна», діями
  Відкрити / Активувати / Перейменувати / Видалити, кнопкою «Створити групу».
- **Сторінка групи** (`/admin/groups/:id`, `GroupDetailTab.vue`): таблиця
  учасників з колонками «Оригінал» (клік — збільшити, кнопка завантаження) і
  «Початок / Кінець», перейменування, пропуск, порядок, «Генерувати» (вимкнено
  без оригіналу), «Згенерувати всім (N)», історія генерацій учасника
  (діплінк на вкладку «Генерації» з фільтром).
- **Генерації**: фільтри «група / учасник / статус», чіп групи + ім'я учасника +
  прев'ю оригіналу в кожній картці, бейдж «застосовано», дії
  «Застосувати» / «Перегенерувати» / видалити; модалка з «Лише початок» /
  «Лише кінець».
- **Скріни**: підказка, з якої групи знімається кадр; назва групи в історії
  та модалці (`screenshots.group_id`).
- **Налаштування**: окрема плашка **«API-токени»** (OpenRouter key зі статусом,
  балансом і кнопкою заміни ключа) — відділена від параметрів AI-генерації.
- **Хедер**: лише «Перегляд зустрічі: Початок зустрічі / Кінець зустрічі»
  (на сторінці групи прев'ю показує саме її, інакше — активну групу).

### Видалено

- **Лабораторія деградації**: view `DegradeLabView.vue`, маршрут `/degrade-lab`,
  endpoints `/api/degrade-methods`, `/api/degrade-spec`, `/api/degrade-preview`.
  Сервіс `degrade.ts` лишився — він живить авто-деградацію генерацій
  (settings `gen_degrade*`) і cam-гейт рендеру (`?cam=`, без нього байт-у-байт).
- Кнопки **завантаження HTML** (початок/кінець) з хедера. Endpoint
  `/api/render?download=1` лишився для сумісності.
- Старий «Редактор» (`EditorView.vue`, `ParticipantSlot.vue`) і його
  `ParticipantsTab.vue` (замінений сторінкою групи), `splitCollage` з
  `lib/util.ts` (розрізання тепер серверне).

### REST API (зміни)

| Маршрут | Зміна |
| --- | --- |
| `GET/POST /api/groups`, `PUT/DELETE /api/groups/<id>`, `POST /api/groups/<id>/activate` | **нові** — CRUD груп + активація |
| `GET /api/participants?group=N` | список у межах групи (без `group` — активна) |
| `POST /api/participants` | + `group_id` у тілі |
| `PUT/DELETE /api/participants/<id>` | **числовий id** замість device_id; PUT приймає `source_data_url` |
| `POST /api/participants/reorder` | `{group_id, order: [id, …]}` |
| `GET /api/avatar/<id>?which=start\|end\|source` | числовий id; нове `which=source` |
| `GET /api/render?group=N` | новий параметр (дефолт — активна група) |
| `POST /api/generate` | `participant_id` числовий; вимагає source |
| `GET /api/generations?group=&participant_id=&status=` | нові фільтри; у відповіді `group_id`, `group_name`, `approved_at` |
| `POST /api/generations/<id>/approve` | `{side: both\|start\|end}` — серверне розрізання колажа, без видалення |
| `GET /api/degrade-*` | **видалені** |
| `GET /api/admin/export` | версія 2: `groups[{name, participants[…source_data_url]}]`; import розуміє v2 і legacy v1 |

### Тести

- `e2e/helpers.ts` — спільний запуск зібраного застосунку з **ізольованим
  userData** (env `MEET_USERDATA` → тимчасова тека, свіжа БД; підтримка в
  `src/main/index.ts`).
- `e2e/smoke.spec.ts` — вікно, чистий хедер, набір вкладок.
- `e2e/flows.spec.ts` — наскрізні UI-флоу **без OpenRouter** (безпечно для CI):
  групи (створення/активація/видалення), учасники (аплоад оригіналу, генерація
  вимкнена без нього, перейменування), рендер активної групи, прев'ю з хедера,
  скрін у історію з назвою групи, фільтри генерацій, плашка API-токенів.
- `e2e/live-generation.spec.ts` — **живий** конвеєр з реальною AI-генерацією
  (витрачає гроші): самопропускається без `E2E_LIVE=1`; фото —
  `E2E_LIVE_PHOTO`, оверрайди `E2E_LIVE_PROVIDER`/`E2E_LIVE_TIER` (бо
  google-vertex не підтримує flex-тариф для gemini-2.5-flash-image, а
  google-ai-studio буває rate-limited upstream).
- Результат прогону: **14/14** UI-тестів зелені; live-цикл (оригінал →
  генерація → застосувати → рендер з фото → скріни початку/кінця) пройшов
  end-to-end на провайдері google-vertex.

### Файли

Бекенд: `src/main/services/{db,groups*,participants,generations,media,render,screenshots,degrade,admin,config,openrouter}.ts`, `src/main/{routes,index}.ts` (* — новий).
UI: `renderer/src/{router,types}.ts`, `views/AdminView.vue`,
`components/admin/{GroupsTab*,GroupDetailTab*,GenerationsTab,ScreenshotsTab,SettingsTab}.vue`,
`renderer/public/assets/css/admin.css`, `lib/util.ts`.
Тести: `e2e/{helpers*,smoke.spec,flows.spec*,live-generation.spec*}.ts`.
Документація: `CLAUDE.md`, `README.md`, цей файл.

---

## Попередня історія (до запровадження журналу)

- **2026-06-02** — dev-тулінг: DevTools/Vue Devtools (dev-only), Playwright E2E,
  PR-CI (`.github/workflows/ci.yml`, build+E2E на win+mac), надійне завантаження
  Electron-бінарника (`scripts/ensure-electron.mjs`, postinstall + крок CI).
- **2026-06-01** — Electron-перепис: main-процес на TypeScript (порт усіх
  PHP-модулів; `node:sqlite`, sharp, `webContents.capturePage`), кастомний
  протокол `app://` з REST-поверхнею як у PHP, renderer переписано на
  **Vue 3 + Vite SPA** (hash-роутинг), авто-апдейт `electron-updater`
  (GitHub Releases; mac — без підпису, апдейт вимкнено), збірка
  `electron-builder` (NSIS + dmg/zip).
- Раніше (корінь репо) — PHP-версія: див. `../../CLAUDE.md`.
