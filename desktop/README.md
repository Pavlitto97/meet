# Meet Editor — Desktop (Electron)

Кросплатформний (Windows + macOS) перепис PHP-редактора збереженої сторінки Meet
на **Electron**. Усі дані й генерації — **локально**, авто-апдейти — з приватного
GitHub-репо. Рендер `index.html` лишився **байт-у-байт** ідентичним PHP-версії.

## Стек (звірено середина-2026)

| Шар | Технологія |
| --- | --- |
| Оболонка | Electron 42 (Chromium 148 / Node 24.15) |
| Мова | TypeScript у `main`, vanilla HTML/JS у `renderer` |
| БД | **node:sqlite** (вбудований у Node 24 — без нативної збірки) |
| Зображення | **sharp** 0.34 (заміна PHP GD) |
| Скріни | `webContents.capturePage()` на offscreen-вікні (без зовнішнього Chrome) |
| Транспорт | кастомний протокол **`app://`** (REST `/api/*` як у PHP, але в main-процесі) |
| Апдейти | electron-updater + electron-builder (GitHub Releases) |
| Логи | electron-log (`~/Library/Logs/<app>` / `%APPDATA%\<app>\logs`) |

> **Чому node:sqlite, а не better-sqlite3:** better-sqlite3 12.x **не компілюється**
> під V8 Electron 42 (зміни C++ API). node:sqlite вбудований, байт-безпечний для BLOB
> і не потребує `@electron/rebuild`.

## Запуск (dev)

```bash
cd desktop
npm install
npm start            # tsc + electron
npm run dev          # tsc -w (в окремому терміналі) + `electron .`
```

Редактор відкривається на `app://meet/editor.html`. Адмінка — `app://meet/admin.html`,
лабораторія деградації — `app://meet/degrade-lab.html`.

## Креди (.env)

`.env` **закомічено в приватний репо** (рішення проєкту — «забути про сікюрність»).
Заповни перед збіркою:

```
OPENROUTER_API_KEY=sk-or-...     # ключ генерації (окремий, зі спенд-лімітом)
GH_TOKEN=github_pat_...          # fine-grained PAT, цей репо, Contents: Read —
                                 # клієнт ним тягне приватні релізи для авто-апдейту
```

> Ключ і токен потрапляють у бандл застосунку й витягуються будь-ким з інсталяцією —
> прийнятно, поки репо й дистрибуція приватні. Не публікуй репо.

## Дані (локально)

Усе — в `app.getPath('userData')`:
- `data.db` — SQLite (учасники, налаштування, генерації, скріни, журнал) — схема 1:1 з PHP.
- `promt.md` — промт.
- `index.html`/`index.html.bak` — read-only у ресурсах застосунку (рендер їх не мутує).

## Білд і реліз (авто-апдейт)

```bash
npm run dist:win     # NSIS .exe (+latest.yml, .blockmap) — авто-апдейт працює
npm run dist:mac     # dmg + zip (universal arm64+x64), unsigned
npm run publish      # build + electron-builder --publish always
```

CI: `.github/workflows/release.yml` — пуш тегу `vX.Y.Z` білдить на `windows-latest`
+ `macos-latest` і публікує в Releases (через `GITHUB_TOKEN`).

- **Windows:** авто-апдейт працює і без підпису (юзер бачить попередження SmartScreen).
- **macOS:** Squirrel.Mac **відмовляє непідписаним апдейтам** → поки збираємо unsigned,
  Mac-юзери ставлять вручну (і проходять Gatekeeper). Тихий авто-апдейт на Mac
  увімкнеться разом з Apple Developer ID + нотаризацією (одне поле `mac.identity`
  в `electron-builder.yml` + секрети нотаризації в CI).

## Дебаг (рекомендований сетап для AI-агента)

```bash
npm run debug        # electron з --inspect=9229 (main) + --remote-debugging-port=9222 (renderer)
```

**MCP-сервери:**
- **Playwright MCP** (вже підключений) — націлити на renderer:
  `npx @playwright/mcp@latest --cdp-endpoint=http://127.0.0.1:9222`
- **chrome-devtools-mcp** (консоль/network/perf зі source-map):
  `claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest --browser-url http://127.0.0.1:9222`

**VS Code:** `.vscode/launch.json` → компаунд «Electron: main + renderer» (Node@9229 + Chrome@9222).
Source maps увімкнені (`tsconfig sourceMap:true`).

## Архітектура (відповідність PHP)

```
src/main/
  index.ts            ← server.php/router.php: lifecycle, app://, БД, вікно, апдейтер
  protocol.ts         ← serve_file + диспетч REST через app://
  http.ts             ← http.php: MeetRequest/MeetResponse, route(), dispatch()
  routes.ts           ← routes.php: уся REST-поверхня
  updater.ts          ← electron-updater + electron-log
  services/
    config.ts         ← config.php (latin1→utf8 mojibake, дефолти, emoji-мапа)
    paths.ts          ← шляхи (userData / resources)
    db.ts             ← db.php на node:sqlite (схема 1:1, BLOB, міграції)
    media.ts          ← media.php (data:URL ↔ Buffer)
    settings.ts       ← settings.php (секрети приховано)
    participants.ts   ← participants.php (CRUD + reorder)
    openrouter.ts     ← openrouter.php (curl → native fetch)
    degrade.ts        ← degrade.php (GD → sharp; CSS-метод формула-в-формулу)
    render.ts         ← render.php (БАЙТОВА заміна у latin1; верифіковано cmp = PHP)
    generations.ts    ← generations.php (inline-async замість детачнутого воркера)
    screenshots.ts    ← screenshots.php (headless Chrome → capturePage)
    admin.ts          ← admin.php (stats/system/db/export/import/backup)
renderer/             ← editor.html / admin.html / degrade-lab.html + assets (без змін)
resources/            ← index.html (2.9MB) + .bak
```

## Калібрування webcam-деградації

sharp ≠ PHP GD байт-у-байт. Криві сили (`blur` sigma, шум, якість JPEG) у
`degrade.ts::webcamize()` — наближення GD-конвеєра. Підкрути їх у `degrade-lab.html`
(порівняння «оригінал ↔ результат», повзунок сили) під бажаний вигляд. CSS-метод
(`camSpec`) портований формула-в-формулу — там калібрування не треба.

## Перевірено

- `tsc` — без помилок.
- `/api/render` (start+end) — **байт-у-байт** ідентичний PHP (`cmp`, 2 894 569 B).
- Роутер + сервіси — end-to-end (settings/participants/render/degrade/admin/404).
- sharp-конвеєр — gd-jpeg/gd-full/resizeToCover дають валідні JPEG.
