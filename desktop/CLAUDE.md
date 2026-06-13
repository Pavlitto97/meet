# Meet Editor — desktop (Electron) — нотатки для AI

Кросплатформний (Windows + macOS) Electron-перепис редактора Meet. Цей файл
вантажиться автоматично, коли працюєш у `desktop/`. Загальний контекст проєкту —
у кореневому `../CLAUDE.md`.

## Документація змін — ОБОВ'ЯЗКОВО

Кожну суттєву зміну (нова фіча, зміна схеми БД/API/UI, видалення функціоналу)
**документуй у `docs/CHANGELOG.md`** (новий запис зверху: що зроблено, навіщо,
які файли, як перевірено). Це пряма вимога користувача — щоб потім можна було
зрозуміти, які зміни проведені і який функціонал розроблений.

## Завжди дотримуйся при розробці цього додатку

Коли пишеш/змінюєш код цього Electron-додатку, ОБОВʼЯЗКОВО тримайся двох джерел:

- **Агент `electron-pro`** — `../.claude/agents/electron-pro.md`. Стандарти Electron:
  безпека (context isolation, вимкнений nodeIntegration, CSP, валідація IPC),
  архітектура процесів, керування вікнами, авто-апдейт, перформанс, мультиплатформна
  збірка. Для більших Electron-задач можна делегувати йому: `Task(subagent_type:
  "electron-pro", …)`.
- **Скіл `electron-best-practices`** — `../.claude/skills/electron-best-practices/`.
  Глибші референси: typed IPC (contextBridge), security-checklist, packaging +
  code signing/notarization, CI/CD, Playwright-E2E. ⚠️ Скіл орієнтований на **React**
  (у нас Vue) і його `scripts/*.ts` потребують **Deno** — бери з нього framework-agnostic
  частини (безпека/IPC/пакування/підпис/CI/тести), React-специфіку ігноруй.

### Короткий чекліст (тримай у голові завжди)

- Context isolation **увімкнено**, `nodeIntegration` **вимкнено** у рендерах.
- Доступ до Node лише через **preload** (`src/preload/`) + валідовані IPC-канали.
- Жодного `remote`, жодного завантаження недовіреного контенту з `webSecurity:false`.
- Секрети/токени — не в рендері; рендер ходить лише через `app://` (REST у `protocol.ts`).
- Авто-апдейт через `electron-updater` (GitHub Releases) — підпис обовʼязковий на mac.
- Старт < 3 c, idle-памʼять розумна; чистити слухачі/вікна, не плодити процеси.

## Інструменти розробки (підключені)

- **DevTools** (`src/main/index.ts`): у dev (`!app.isPackaged` і не під E2E/CI)
  автоматично відкривається нативна DevTools-панель і ставиться розширення
  **Vue Devtools** (`electron-devtools-installer`, dynamic import, try/catch).
  ⚠️ **Обмеження Electron #34386:** DevTools-**розширення** НЕ чіпляються, коли
  рендер віддається кастомним протоколом `app://` — тільки http/https. Оскільки і
  SPA, і весь `/api/*` живуть на origin `app://meet`, панель Vue Devtools у
  поточному dev-флоу не зʼявиться (нативний інспектор/Console/Network — працюють).
  Щоб розширення запрацювало, потрібен dev-флоу з рендером по http (vite dev server)
  + проксі `/api` — це окрема задача (перепис backend на HTTP у dev), поки не робимо.
- **Playwright E2E** (`playwright.config.ts`, `e2e/*.spec.ts`): `npm run test:e2e`
  (білд → `playwright test`). Тести піднімають ЗІБРАНИЙ застосунок через спільний
  хелпер `e2e/helpers.ts::launchApp()` — він створює **ізольований userData**
  (tmp-тека → свіжа БД через env `MEET_USERDATA`, дев-дані не чіпаються) і
  **прибирає `ELECTRON_RUN_AS_NODE`** із env запуску (інакше electron-бінарник
  стартує як чистий Node без GUI/`protocol` і запуск падає). Спеки:
  `smoke.spec.ts` (вікно/хедер/вкладки), `flows.spec.ts` (групи → учасники →
  source-аплоад → рендер → слайд → видалення/відновлення → скрін → налаштування;
  БЕЗ OpenRouter — грошей не витрачає, безпечно на CI), `crop.spec.ts` і
  `retouch.spec.ts` (кроп/ретуш генерації; готова генерація сідиться напряму в
  SQLite темп-БД), `live-generation.spec.ts` (реальна AI-генерація,
  **самопропускається** без `E2E_LIVE=1`; фото — env `E2E_LIVE_PHOTO=/шлях.jpg`).
- **GitHub MCP** (user-scope, `~/.claude.json`): remote-HTTP сервер
  `https://api.githubcopilot.com/mcp/` з токеном `gh`. Дає Claude версіонування,
  PR-и, GitHub Actions/релізи прямо з сесії. Токен НЕ в репозиторії.

## Релізи (локально) / збірки

> **GitHub Actions ВИМКНЕНО** (платні хвилини на приватному репо — рішення користувача):
> `release.yml` і `ci.yml` лишаються в репо, але `disabled_manually` (повернути:
> `gh workflow enable "CI"` / `"Release Desktop"` + робочий білінг). Релізимо **локально**.

- **Реліз — локально з macOS** (electron-builder збирає і Windows-NSIS [x64], і Mac
  dmg/zip, і публікує у GitHub Releases). Стисло: bump `version` → коміт → тег `vX.Y.Z`
  (= version) → `npm run build` → `GH_TOKEN="$(gh auth token)" env -u ELECTRON_RUN_AS_NODE
  npx electron-builder --win --mac --publish always` → `gh release edit vX.Y.Z
  --draft=false --latest`. Далі Windows-клієнти оновлюються самі (10 c / 6 год / банер).
  **Повний runbook (два токени, передумови, «перший раз вручну», чеклист) — `docs/RELEASE.md`.**
- **Креди застосунку** (`OPENROUTER_API_KEY`, `GH_TOKEN` для апдейту) — із закоміченого
  `desktop/.env` (`!desktop/.env` у `.gitignore`), бейкаються в інсталятор. Токен
  ПУБЛІКАЦІЇ — окремий (`gh auth token`, scope `repo`), лише в shell, у застосунок не йде.
- ⚠️ **win-арх = x64 явно** (`electron-builder.yml`): default-арх = арх ХОСТА, тож на
  Apple Silicon `--win` без цього зібрав би arm64 (і `latest.yml` вказав би на arm64).
- electron-builder створює реліз як **draft** → крок `--draft=false` обовʼязковий, інакше
  клієнти його не побачать. Реліз має містити `latest.yml` (Windows-фід апдейту).
- ⚠️ **`scripts/ensure-electron.mjs` (postinstall) обовʼязковий, не прибирати:**
  npm-пакет `electron@42` НЕ має власного postinstall, а його `install.js` на CI
  часом виходить ДО завершення async-завантаження → бінарник відсутній, і
  `_electron.launch` у Playwright падає `ENOENT path.txt`. Скрипт робить
  **awaited+verified** завантаження (`@electron/get`, ретраї, пише `path.txt`),
  idempotent. Висить на `postinstall` (свіжий `npm ci` → `npm start`/E2E працюють) і
  окремим кроком `Ensure Electron binary` у `ci.yml` перед E2E.

## Поточні рішення / обмеження

- **macOS — без підпису** (`electron-builder.yml`: `identity: null`). Авто-апдейт на
  mac **вимкнено** (Squirrel.Mac відмовляє непідписаним): `updater.ts` віддає стан
  `disabled` (без помилок), а UI це показує. Щоб увімкнути — потрібні **Apple Developer
  ID + нотаризація**: (1) знести `identity:null`; (2) секрети Actions `CSC_LINK`/
  `CSC_KEY_PASSWORD` + `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (вже
  прокинуті в `release.yml`); (3) клієнт із env `MEET_MAC_UPDATES=1`. Entitlements для
  hardened runtime — `build/entitlements.mac.plist` (на unsigned ігноруються).
  Windows-авто-апдейт працює без підпису.
- **Авто-апдейт — повний цикл із UI:** `updater.ts` тримає єдиний `UpdateStatus` і
  пушить його в рендер (`update:status`); IPC `update:check`/`update:install`/
  `update:get-state`. Рендер: `stores/updates.ts` + глобальний `UpdateBanner.vue`
  (завантаження/готово→«Перезапустити й оновити»/помилка) + картка «Оновлення додатку»
  в Налаштуваннях (версія, ручна перевірка). Приватний репо: токен `GH_TOKEN`/
  `GITHUB_TOKEN` із `.env` → `autoUpdater.addAuthHeader` (лишається в main).
- **Деінсталяція ЛИШАЄ дані** (рішення користувача): NSIS `deleteAppDataOnUninstall:
  false` — БД/аватарки/скріни/кеш-ключ у `%APPDATA%\Meet Editor` переживають видалення.
  macOS — `scripts/uninstall-macos.sh` (`--purge` для повного стирання).
- `.env` свідомо комітиться (рішення проєкту — креди в приватному репо). Для
  авто-апдейту приватного репо в нього додають `GH_TOKEN` (PAT, Contents: Read).

## Доменна модель (групи учасників + source-зображення)

- **Шаблон** — збережена сторінка Meet **mqy-kiph-fci** (укр. локаль, 24-год час
  `13:41` без AM/PM, Sandro презентує, відкрита панель «Люди»). Обробка сирого
  HTML — `scripts/process-template.mjs` (зачистка, локалізація ресурсів, буквені
  SVG `renderer/public/assets/img/people/uN.svg`). Рендер підміняє аватарки
  глобальним `replaceAll` по імені файла `uN.svg` (плитка + панель «Люди» +
  «Ще 3 особи» + бейдж People синхронно). Без фото — буквений SVG: літера з
  актуального імені, колір з детермінованого розкладу групи (PRNG, сід = id
  групи; стабільно між start/end). **Sandro (devices/316) закріплений**: завжди
  `#8d6e63` з S. Head-inject пінить `c-wiz.SSPGKf` до 2560×1271 і вмикає
  `transform:scale(1)` на `#yDmH0d` (containing block для fixed) — інакше
  `width:100vw; overflow:hidden` кліпає плитки у вузьких вікнах/капчерах.
- **Групи** (`services/groups.ts`, таблиця `groups`): кілька іменованих складів
  учасників. Кожна група має ВЛАСНІ 11 слотів плиток (`UNIQUE(group_id, device_id)`,
  сід — `db.ts::seedGroupParticipants`) і опційний **слайд презентації**
  (`groups.slide`, API `GET/PUT/DELETE /api/groups/<id>/slide`) — зображення, яке
  рендер вставляє замість `<video data-uid="100">` (область презентації).
  **Активна група** (settings `active_group_id`, самолікується) — її учасників
  беруть `/api/render` і скріни; явний оверрайд — `?group=N`. Останню групу
  видалити не можна.
- **Видалення учасника** (`DELETE /api/participants/<id>`): user_added —
  назавжди; дефолтний слот — м'яко (`deleted=1`, правки скинуто, рендер показує
  рідну плитку шаблону), відновлення — `POST .../restore`,
  список — `GET /api/participants?deleted=1`.
- **Учасник** адресується числовим `id` (НЕ device_id). Три зображення:
  `source`(+`_mime`) — оригінальне фото, з якого генерує AI (зберігається як є,
  лише страховий downscale >1600px у `degrade.ts::normalizeSourceImage`);
  `avatar` — «початок»; `avatar_end` — «кінець» (обидва — downscale під плитку).
  `GET /api/avatar/<id>?which=start|end|source`.
- **Генерація** (`services/generations.ts`): вхід — ЗАВЖДИ source учасника
  (без source → 400); знімок входу лягає в `generations.input_image` (прев'ю
  «оригінал» в UI). Результат — 16:9-колаж «початок|кінець» (`resources/promt.md`).
  **Approve** (`POST /api/generations/<id>/approve {side:both|start|end}`) ріже
  колаж навпіл через sharp (широкий → ліво/право; високий h/w>1.3 → верх/низ),
  зменшує під плитку і пише в avatar/avatar_end; генерація НЕ видаляється —
  ставиться `approved_at` (єдина «застосована» на учасника; історія для порівняння).
  **Regenerate** — ті ж параметри, але вхід перечитується з АКТУАЛЬНОГО source.
  **Ретуш** (`RetouchModal.vue`, `POST /api/generations/<id>/retouch`): кисть або
  прямокутна область × ефекти пікселізація/блюр/замазування на canvas у рендері;
  перезаписує `image`, оригінал відкладається в `image_orig` при першій ретуші
  (`POST .../restore-image` повертає). Кроп/approve йдуть уже з ретушованим кадром.
- **Лабораторії деградації немає** (UI і degrade-* endpoints видалені). Сам
  `services/degrade.ts` живий: авто-деградація генерацій (settings `gen_degrade*`),
  resize-хелпери, cam-гейт рендеру (`?cam=`, дефолт none → байт-у-байт).
- Міграція старої одногрупної схеми (device_id PK) — автоматична в
  `db.ts::migrateParticipantsToGroups` (група №1, перешивка generations.participant_id).

## Структура

- `src/main/` — main-процес (заміна server.php/router.php): `index.ts` (вхід, вікно,
  DevTools, `MEET_USERDATA`-оверрайд для тестів), `protocol.ts` (`app://` → REST+статика),
  `http.ts`/`routes.ts` (роутер), `services/*` (db/groups/participants/generations/
  render/screenshots/degrade/openrouter/settings/admin/media/paths/config),
  `updater.ts` (electron-updater: статус-модель + IPC `update:*`).
- `src/preload/index.ts` — місток у рендер (contextIsolation): `meet.versions` +
  `meet.updates` (getState/check/install/onStatus). Тип — дзеркало в `renderer/env.d.ts`.
- `renderer/` — Vue 3 + Vite SPA (hash-роутинг), білд у `renderer/dist`. Вкладки
  адмінки: **Групи** (`GroupsTab` → `GroupDetailTab` — учасники групи з трьома
  зображеннями Оригінал/Початок/Кінець), Генерації (фільтри група/учасник/статус,
  бейджі групи + «застосовано», діплінк `?participant=N`), Скріни (з назвою групи),
  Налаштування (плашки «API-токени» + «Оновлення додатку»), Промт. Хедер — лише
  «Перегляд зустрічі: Початок/Кінець» (download HTML і лабораторію прибрано).
  Глобально (App.vue): `UpdateBanner.vue` (банер апдейтера) + `stores/updates.ts`.
- `resources/` — `index.html`(+`.bak`), `promt.md` (ship як extraResources).
- `e2e/` — Playwright-тести (`helpers.ts` + smoke/flows/live-generation).
  `out/` — компіляція main/preload. `dist/` — вивід electron-builder.
