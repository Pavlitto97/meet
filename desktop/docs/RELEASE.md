# Реліз і авто-апдейт — runbook для агента

Як зібрати застосунок, підняти версію й випустити реліз так, **щоб у юзерів спрацював
авто-апдейт**. Стисла версія — у `../CLAUDE.md` (секція «Релізи»). Архітектура
апдейтера — `src/main/updater.ts`; журнал — `docs/CHANGELOG.md`.

> **GitHub Actions ВИМКНЕНО** (платні хвилини на приватному репо — рішення проєкту).
> Релізимо **локально** з macOS: electron-builder збирає і Windows (NSIS), і Mac, і
> публікує у GitHub Releases. Воркфлоу `release.yml`/`ci.yml` лишаються в репо, але
> `disabled_manually` (повернути: `gh workflow enable "CI"` / `"Release Desktop"`).

## Як працює авто-апдейт (1 абзац)

Встановлений застосунок (`src/main/updater.ts`, electron-updater) через 10 c після
старту і далі кожні 6 год читає **GitHub Releases** приватного репо `Pavlitto97/meet`
(фід `latest.yml`). Якщо там версія новіша за `app.getVersion()` — тихо качає
інсталятор у фоні (диференційно, по `.blockmap`) і показує банер «Перезапустити й
оновити» (`UpdateBanner.vue`), або застосовує при наступному виході. Форс-перевірка з
UI: **Налаштування → Оновлення додатку**. **Windows** — працює; **macOS** — вимкнено
(білд без підпису), mac-юзери качають новий `.dmg` вручну.

## Два РІЗНІ токени (не плутати)

| Токен | Де живе | Навіщо | Доступ |
|---|---|---|---|
| `GH_TOKEN` у `desktop/.env` (закомічений) | бейкається в кожен інсталятор | застосунок **читає** приватний реліз для апдейту | fine-grained PAT, Contents: **Read** |
| токен публікації | shell-env при `electron-builder --publish` | **створити/залити** реліз у репо | `gh auth token` (scope `repo`) або PAT Contents: **Write** |

> Це РІЗНІ токени. Read-токен із `.env` потрапляє в застосунок; write-токен — лише в
> твоєму терміналі під час публікації, у застосунок НЕ потрапляє.

## Передумови (одноразово — вже зроблено)

- **Node 24** для всіх білд-команд (shell може дефолтити на старий node):
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"     # або: nvm use 24
  ```
- **`gh` залогінений** із scope `repo` (перевірити: `gh auth status`) — ним публікуємо.
- **`desktop/.env`** містить валідний `GH_TOKEN` (Contents: Read) і закомічений. Перевірити:
  ```bash
  tok=$(grep '^GH_TOKEN=' desktop/.env | cut -d= -f2-)
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: token $tok" \
    https://api.github.com/repos/Pavlitto97/meet/releases       # очікувано: 200
  ```

## Випуск релізу — покроково (локально)

```bash
cd desktop
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"

# 1. Підняти версію (СТРОГО вища за встановлену в юзерів; semver)
npm version 0.1.2 --no-git-tag-version          # тільки міняє package.json "version"
git commit -am "release: v0.1.2"

# 2. Тег = версія + пуш (тег фіксує коміт релізу; Actions вимкнено — не тригериться)
git tag v0.1.2
git push origin electron-rewrite && git push origin v0.1.2

# 3. Зібрати Win+Mac і залити ассети в реліз (electron-builder створює DRAFT)
npm run build
GH_TOKEN="$(gh auth token)" env -u ELECTRON_RUN_AS_NODE \
  npx electron-builder --win --mac --publish always

# 4. Опублікувати реліз (зняти draft) — лише тепер клієнти його побачать
gh release edit v0.1.2 --repo Pavlitto97/meet --draft=false --latest

# 5. Перевірити ассети (МАЮТЬ бути: .exe, latest.yml, .blockmap [+ mac dmg/zip])
gh release view v0.1.2 --repo Pavlitto97/meet --json isDraft,assets \
  -q '{draft: .isDraft, assets: [.assets[].name]}'
```

Готово. Windows-клієнти підхоплять оновлення (на старті +10 c або кожні 6 год) і
покажуть банер «Перезапустити й оновити».

## Залізні правила

- `version` у `package.json` має РОСТИ між релізами; тег `vX.Y.Z` = `version` (у
  package.json без префікса `v`). Однакова/менша версія → клієнт ігнорує.
- Реліз має бути **опублікований** (не draft) і містити **`latest.yml`** — інакше клієнт
  його не бачить. Тому крок 4 (`--draft=false`) обовʼязковий.
- `GH_TOKEN` у `.env` валідний на момент білду (він у кожному інсталяторі).
- **«Перший раз — вручну».** Збірка зі старим/порожнім токеном сама НЕ оновиться. Раз
  дай юзерам поставити свіжий інсталятор (із цим `.env`) — далі вже автоматично.
- **macOS не авто-оновлюється** (unsigned) — mac-юзери качають новий `.dmg` із Release
  вручну, поки не заведено Apple Developer ID (`../CLAUDE.md` → «Поточні рішення»).
- Збираєш на macOS: `--win` дає NSIS (вбудований makensis, без Wine), `--mac` — dmg+zip.
  Потрібні платформенні бінарники sharp (`@img/sharp-win32-x64`, `@img/sharp-darwin-*`);
  якщо нема — `npm i --no-save --cpu=<arch> --os=<win32|darwin> sharp`.

## Локальний білд без публікації (перевірка)

```bash
cd desktop && export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
npm run build
env -u ELECTRON_RUN_AS_NODE npm run dist:win    # NSIS .exe + latest.yml у dist/
env -u ELECTRON_RUN_AS_NODE npm run dist:mac    # dmg + zip (unsigned)
```

## Якщо оновлення не приходить — чеклист

- Реліз **опублікований** (не draft, `isDraft:false`) і містить `latest.yml`?
- Версія релізу > встановленої в юзера?
- У встановленого білду в `.env` був валідний `GH_TOKEN`? Інакше — «перший раз вручну».
- Платформа Windows? (на macOS авто-апдейт вимкнено.)
- Лог клієнта: `%APPDATA%\Meet Editor\logs\main.log` (win) — шукати рядки `updater:`.
