# Meet Editor — desktop (Electron) — нотатки для AI

Кросплатформний (Windows + macOS) Electron-перепис редактора Meet. Цей файл
вантажиться автоматично, коли працюєш у `desktop/`. Загальний контекст проєкту —
у кореневому `../CLAUDE.md`.

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
  (білд → `playwright test`). Тест піднімає ЗІБРАНИЙ застосунок через
  `_electron.launch({args:['.']})` і перевіряє вікно/монтування Vue. Інсталятор НЕ
  потрібен. ⚠️ Спека **прибирає `ELECTRON_RUN_AS_NODE`** із env запуску: якщо ця
  змінна стоїть (деякі sandbox/CI її виставляють), electron-бінарник стартує як
  чистий Node — без GUI/`protocol` — і запуск падає («bad option:
  --remote-debugging-port» / `protocol undefined`). Видалення гарантує повноцінний Electron.
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
- ⚠️ **`postinstall` у package.json обовʼязковий, не прибирати:** npm-пакет
  `electron@42` НЕ має власного postinstall, тож `npm ci` сам по собі НЕ тягне
  бінарник Electron (нема `node_modules/electron/path.txt`) — і `_electron.launch`
  у Playwright падає `ENOENT path.txt`. Наш `postinstall: node
  node_modules/electron/install.js` (idempotent, `@electron/get`) тягне бінарник на
  будь-якому чистому `npm ci` — потрібно і для CI-E2E, і щоб `npm start` працював зі свіжого клону.

## Поточні рішення / обмеження

- **macOS — без підпису** (`electron-builder.yml`: `identity: null`,
  `CSC_IDENTITY_AUTO_DISCOVERY:false`). Авто-апдейт на mac **вимкнено**: Squirrel.Mac
  відмовляє непідписаним білдам. Щоб увімкнути — потрібні **Apple Developer ID +
  нотаризація** (сертифікати в секрети Actions: `CSC_LINK`/`CSC_KEY_PASSWORD` +
  `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`), тоді знести `identity:null`.
  Windows-авто-апдейт працює без підпису.
- `.env` свідомо комітиться (рішення проєкту — креди в приватному репо).

## Структура

- `src/main/` — main-процес (заміна server.php/router.php): `index.ts` (вхід, вікно,
  DevTools), `protocol.ts` (`app://` → REST+статика), `http.ts`/`routes.ts` (роутер),
  `services/*` (порти PHP-модулів: db/render/participants/generations/screenshots/…),
  `updater.ts` (electron-updater).
- `src/preload/index.ts` — місток у рендер (contextIsolation).
- `renderer/` — Vue 3 + Vite SPA (hash-роутинг), білд у `renderer/dist`.
- `resources/` — `index.html`(+`.bak`), `promt.md` (ship як extraResources).
- `e2e/` — Playwright-тести. `out/` — компіляція main/preload. `dist/` — вивід electron-builder.
