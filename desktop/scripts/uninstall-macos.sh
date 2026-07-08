#!/usr/bin/env bash
#
# Деінсталятор Meet Editor для macOS.
#
# На macOS повноцінного деінсталятора немає (dmg = перетягни .app у кошик), тож цей
# скрипт — опційний помічник, який прибирає застосунок і (за бажанням) залишкові дані.
#
# За замовчуванням (рішення проєкту — «лишати дані») видаляє ЛИШЕ застосунок, а локальні
# дані (БД, аватарки, скріни, кешований OpenRouter-ключ) лишає недоторканими.
# Прапорець --purge додатково стирає ВСІ локальні дані застосунку.
#
#   bash scripts/uninstall-macos.sh            # видалити лише .app (дані лишити)
#   bash scripts/uninstall-macos.sh --purge    # + стерти всі локальні дані та кеш
#   bash scripts/uninstall-macos.sh --purge -y # без інтерактивного підтвердження
#
set -euo pipefail

APP_NAME="Meet Editor"
BUNDLE_ID="com.futurra.meeteditor"

PURGE=0
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    *) echo "Невідомий аргумент: $arg" >&2; exit 2 ;;
  esac
done

# Кандидати на видалення: сам застосунок.
APP_PATHS=(
  "/Applications/${APP_NAME}.app"
  "${HOME}/Applications/${APP_NAME}.app"
)

# Локальні дані/кеш (видаляються лише з --purge).
DATA_PATHS=(
  "${HOME}/Library/Application Support/${APP_NAME}"
  "${HOME}/Library/Logs/${APP_NAME}"
  "${HOME}/Library/Caches/${APP_NAME}"
  "${HOME}/Library/Caches/${BUNDLE_ID}"
  "${HOME}/Library/Caches/${BUNDLE_ID}.ShipIt"
  "${HOME}/Library/Preferences/${BUNDLE_ID}.plist"
  "${HOME}/Library/Saved Application State/${BUNDLE_ID}.savedState"
  "${HOME}/Library/HTTPStorages/${BUNDLE_ID}"
)

targets=()
for p in "${APP_PATHS[@]}"; do [ -e "$p" ] && targets+=("$p"); done
if [ "$PURGE" -eq 1 ]; then
  for p in "${DATA_PATHS[@]}"; do [ -e "$p" ] && targets+=("$p"); done
fi

if [ "${#targets[@]}" -eq 0 ]; then
  echo "Нічого видаляти — Meet Editor не знайдено${PURGE:+ (і даних теж)}."
  exit 0
fi

echo "Буде видалено:"
for t in "${targets[@]}"; do echo "  • $t"; done
if [ "$PURGE" -eq 0 ]; then
  echo "(локальні дані лишаються; для повного стирання запусти з --purge)"
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Продовжити? [y/N] " ans
  case "$ans" in y|Y|yes|Yes) ;; *) echo "Скасовано."; exit 1 ;; esac
fi

# Зупинити застосунок, якщо запущений.
osascript -e "quit app \"${APP_NAME}\"" >/dev/null 2>&1 || true
pkill -f "/${APP_NAME}.app/" >/dev/null 2>&1 || true

for t in "${targets[@]}"; do
  rm -rf "$t" && echo "видалено: $t"
done

echo "Готово."
