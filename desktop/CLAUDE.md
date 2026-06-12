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
  source-аплоад → рендер → скрін → налаштування; БЕЗ OpenRouter — грошей не
  витрачає, безпечно на CI), `live-generation.spec.ts` (реальна AI-генерація,
  **самопропускається** без `E2E_LIVE=1`; фото — env `E2E_LIVE_PHOTO=/шлях.jpg`).
- **GitHub MCP** (user-scope, `~/.claude.json`): remote-HTTP сервер
  `https://api.githubcopilot.com/mcp/` з токеном `gh`. Дає Claude версіонування,
  PR-и, GitHub Actions/релізи прямо з сесії. Токен НЕ в репозиторії.

## CI / збірки (GitHub Actions)

- **`.github/workflows/release.yml`** — тригер на тег `v*`: `electron-builder`
  публікує **Windows NSIS** (авто-апдейт) і **macOS dmg/zip** у GitHub Releases.
- **`.github/workflows/ci.yml`** — тригер на PR/пуш: `npm run test:e2e` (білд +
  Playwright) на `windows-latest` + `macos-latest`.
- Реліз: підняти `version` у `package.json` → тег `vX.Y.Z` → пуш → Actions збере й
  опублікує. `electron-updater` на клієнтах читає ці релізи.
- ⚠️ **`scripts/ensure-electron.mjs` (postinstall) обовʼязковий, не прибирати:**
  npm-пакет `electron@42` НЕ має власного postinstall, а його `install.js` на CI
  часом виходить ДО завершення async-завантаження → бінарник відсутній, і
  `_electron.launch` у Playwright падає `ENOENT path.txt`. Скрипт робить
  **awaited+verified** завантаження (`@electron/get`, ретраї, пише `path.txt`),
  idempotent. Висить на `postinstall` (свіжий `npm ci` → `npm start`/E2E працюють) і
  окремим кроком `Ensure Electron binary` у `ci.yml` перед E2E.

## Поточні рішення / обмеження

- **macOS — без підпису** (`electron-builder.yml`: `identity: null`,
  `CSC_IDENTITY_AUTO_DISCOVERY:false`). Авто-апдейт на mac **вимкнено**: Squirrel.Mac
  відмовляє непідписаним білдам. Щоб увімкнути — потрібні **Apple Developer ID +
  нотаризація** (сертифікати в секрети Actions: `CSC_LINK`/`CSC_KEY_PASSWORD` +
  `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`), тоді знести `identity:null`.
  Windows-авто-апдейт працює без підпису.
- `.env` свідомо комітиться (рішення проєкту — креди в приватному репо).

## Доменна модель (групи учасників + source-зображення)

- **Групи** (`services/groups.ts`, таблиця `groups`): кілька іменованих складів
  учасників. Кожна група має ВЛАСНІ 11 слотів плиток (`UNIQUE(group_id, device_id)`,
  сід — `db.ts::seedGroupParticipants`). **Активна група** (settings
  `active_group_id`, самолікується) — її учасників беруть `/api/render` і скріни;
  явний оверрайд — `?group=N`. Останню групу видалити не можна.
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
  `updater.ts` (electron-updater).
- `src/preload/index.ts` — місток у рендер (contextIsolation).
- `renderer/` — Vue 3 + Vite SPA (hash-роутинг), білд у `renderer/dist`. Вкладки
  адмінки: **Групи** (`GroupsTab` → `GroupDetailTab` — учасники групи з трьома
  зображеннями Оригінал/Початок/Кінець), Генерації (фільтри група/учасник/статус,
  бейджі групи + «застосовано», діплінк `?participant=N`), Скріни (з назвою групи),
  Налаштування (окрема плашка «API-токени»), Промт. Хедер — лише «Перегляд
  зустрічі: Початок/Кінець» (download HTML і лабораторію прибрано).
- `resources/` — `index.html`(+`.bak`), `promt.md` (ship як extraResources).
- `e2e/` — Playwright-тести (`helpers.ts` + smoke/flows/live-generation).
  `out/` — компіляція main/preload. `dist/` — вивід electron-builder.
