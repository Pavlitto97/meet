# Реліз і авто-апдейт — runbook для агента

Як зібрати застосунок, підняти версію й випустити реліз так, **щоб у юзерів спрацював
авто-апдейт**. Стисла версія — у `../CLAUDE.md` (секція «CI / збірки»). Архітектура
апдейтера — `src/main/updater.ts`; журнал — `docs/CHANGELOG.md`.

## Як працює авто-апдейт (1 абзац)

Встановлений застосунок (`src/main/updater.ts`, electron-updater) через 10 c після
старту і далі кожні 6 год читає **GitHub Releases** приватного репо `Pavlitto97/meet`
(фід `latest.yml`). Якщо там версія новіша за `app.getVersion()` — тихо качає
інсталятор у фоні (диференційно, по `.blockmap`) і показує банер «Перезапустити й
оновити» (`UpdateBanner.vue`), або застосовує при наступному виході. Форс-перевірка з
UI: **Налаштування → Оновлення додатку**. **Windows** — працює; **macOS** — вимкнено
(білд без підпису).

## Два РІЗНІ токени (не плутати)

| Токен | Де живе | Навіщо | Доступ |
|---|---|---|---|
| `GITHUB_TOKEN` | GitHub Actions (авто) | CI **публікує** реліз | Actions дає сам — нічого не робити |
| `GH_TOKEN` | `desktop/.env` (закомічений) | клієнт **читає** приватний реліз; бейкається в кожен інсталятор | fine-grained PAT, Contents: **Read** |

> `desktop/.env` навмисно закомічений (`!desktop/.env` у кореневому `.gitignore`) — без
> нього CI збере застосунок без токена, і авто-апдейт у юзерів мовчки не працюватиме.

## Передумови (одноразово — вже зроблено)

- `desktop/.env` містить валідний `GH_TOKEN` і закомічений. Перевірити доступ токена:
  ```bash
  tok=$(grep '^GH_TOKEN=' desktop/.env | cut -d= -f2-)
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: token $tok" \
    https://api.github.com/repos/Pavlitto97/meet/releases     # очікувано: 200
  ```
- Node 24 для будь-яких білд-команд (shell може дефолтити на старий node):
  ```bash
  export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"    # або: nvm use 24
  # electron-builder/electron запускати з префіксом `env -u ELECTRON_RUN_AS_NODE`
  ```

## Випуск релізу — покроково

1. **Закоміть код**, який має ввійти в реліз (тег чіпляється до коміту).
2. **Підніми версію** (СТРОГО вища за встановлену в юзерів; semver):
   ```bash
   cd desktop
   npm version 0.1.2 --no-git-tag-version      # тільки міняє package.json "version"
   git commit -am "release: v0.1.2"
   ```
3. **Тег = версія**, і пуш (саме push тега запускає `release.yml`):
   ```bash
   git tag v0.1.2
   git push origin electron-rewrite            # коміт
   git push origin v0.1.2                       # тег → запускає CI-реліз
   ```
4. **Дочекайся Actions і перевір ассети релізу:**
   ```bash
   gh run watch --repo Pavlitto97/meet
   gh release view v0.1.2 --repo Pavlitto97/meet --json assets -q '.assets[].name'
   ```
   У релізі МАЮТЬ бути: інсталятор(и) `.exe`, **`latest.yml`**, `.blockmap`. Без
   `latest.yml` клієнт оновлення не побачить.
5. **Готово.** Windows-клієнти підхоплять оновлення (на старті +10 c або кожні 6 год)
   і покажуть банер «Перезапустити й оновити».

## Залізні правила

- `version` у `package.json` має РОСТИ між релізами; тег `vX.Y.Z` точно дорівнює
  `version` (у package.json — без префікса `v`). Однакова/менша версія → клієнт ігнорує.
- `GH_TOKEN` у `.env` валідний на момент білду (він потрапляє в кожен інсталятор).
- **«Перший раз — вручну».** Збірка зі старим/порожнім токеном сама НЕ оновиться. Раз
  дай юзерам поставити свіжий інсталятор (із цим `.env`) — далі вже автоматично.
- **macOS не авто-оновлюється** (unsigned) — mac-юзери качають новий `.dmg` із Release
  вручну, поки не заведено Apple Developer ID (`../CLAUDE.md` → «Поточні рішення»).

## Локальний білд (без релізу / для перевірки)

```bash
cd desktop
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
npm run build                                   # vite + tsc (тайпчек)
env -u ELECTRON_RUN_AS_NODE npm run dist:win    # NSIS .exe + latest.yml у dist/
env -u ELECTRON_RUN_AS_NODE npm run dist:mac    # dmg + zip (unsigned)
```

## Локальний реліз (альтернатива CI)

Якщо треба випустити НЕ через Actions:
```bash
cd desktop
export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"
export GH_TOKEN=<PAT з Contents: WRITE>          # для ПУБЛІКАЦІЇ — НЕ той, що в .env!
env -u ELECTRON_RUN_AS_NODE npm run publish      # build + electron-builder --publish always
```
mac збирає і Windows (NSIS), і Mac. Увага: токен публікації потребує **Write**, а
`.env`-токен — лише **Read** (бейкається в застосунок). Це різні токени.

## Якщо оновлення не приходить — чеклист

- Реліз опублікований (не draft) і містить `latest.yml`? (`gh release view …`)
- Версія релізу > встановленої в юзера?
- У встановленого білду в `.env` був валідний `GH_TOKEN`? Інакше — «перший раз вручну».
- Платформа Windows? (на macOS авто-апдейт вимкнено.)
- Лог клієнта: `%APPDATA%\Meet Editor\logs\main.log` (win) — шукати рядки `updater:`.
