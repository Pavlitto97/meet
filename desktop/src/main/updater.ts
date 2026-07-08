/**
 * Авто-апдейт через electron-updater (GitHub Releases приватного репо) + electron-log.
 *
 * Модель: main тримає ЄДИНИЙ обʼєкт статусу (`UpdateStatus`) і пушить його в рендер
 * каналом `update:status` при кожній зміні. Рендер (`stores/updates.ts`) при монтуванні
 * робить `getState()` (IPC invoke), щоб синхронізуватись, навіть якщо події вже минули.
 *
 * Керування з рендера (preload `meet.updates`):
 *  - `check()`    → ipc `update:check`     — ручна перевірка (кнопка в Налаштуваннях);
 *  - `install()`  → ipc `update:install`   — `quitAndInstall()` (банер «Перезапустити й оновити»);
 *  - `getState()` → ipc `update:get-state` — поточний статус для синхронізації UI.
 *
 * Платформи:
 *  - Windows (NSIS): працює навіть без підпису.
 *  - macOS: Squirrel.Mac відмовляє НЕпідписаним білдам, тож апдейт вимкнено, поки не
 *    зʼявиться Apple Developer ID + нотаризація. Вмикається env `MEET_MAC_UPDATES=1`
 *    (виставляється, коли релізи підписані). Без цього — стан `disabled`, без помилок.
 *  - dev (`!app.isPackaged`): `disabled` (апдейти не працюють із `npm start`).
 *
 * Приватний репозиторій: щоб клієнт міг читати релізи приватного репо, потрібен
 * токен. Беремо `GH_TOKEN`/`GITHUB_TOKEN` з оточення (їх завантажує dotenv із зашитого
 * `.env` ще ДО initUpdater) і кладемо в `Authorization`-хедер через `addAuthHeader`
 * (owner/repo/private читаються з `app-update.yml`, який генерує electron-builder).
 * Без токена перевірка впаде (приватний → 404) і ми покажемо це станом `error` —
 * користувач задасть токен у `.env` («я потім настрою»). Секрет лишається в main,
 * у рендер НЕ потрапляє. Логи апдейтів — ~/Library/Logs/<app> (mac) /
 * %APPDATA%/<app>/logs (win).
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface UpdateStatus {
  state: UpdateState;
  currentVersion: string; // версія встановленого застосунку (app.getVersion())
  version?: string; // версія, що пропонується / завантажена
  percent?: number; // 0..100 під час downloading
  message?: string; // текст помилки (error) або причина (disabled)
}

let status: UpdateStatus = { state: 'idle', currentVersion: '0.0.0' };

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:status', status);
  }
}

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch };
  broadcast();
}

/** Чи підтримується авто-апдейт на цій платформі/збірці (і чому ні). */
function updatesSupported(): { ok: boolean; reason?: string } {
  if (!app.isPackaged) {
    return { ok: false, reason: 'dev-режим: апдейти працюють лише у встановленому застосунку' };
  }
  if (process.platform === 'darwin' && process.env.MEET_MAC_UPDATES !== '1') {
    return { ok: false, reason: 'оновлення на macOS вимкнено (потрібен підпис Apple Developer ID + нотаризація)' };
  }
  return { ok: true };
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // фонова перевірка кожні 6 год
const FIRST_CHECK_DELAY_MS = 10_000; // перша перевірка через 10 c після старту

export function initUpdater(): void {
  status.currentVersion = app.getVersion();
  log.transports.file.level = 'info';

  // IPC реєструємо ЗАВЖДИ (навіть у dev / на mac без підпису), щоб банер і кнопки в
  // UI давали зрозумілий статус, а не падали на undefined-мості.
  ipcMain.handle('update:get-state', () => status);
  ipcMain.handle('update:check', async () => {
    const sup = updatesSupported();
    if (!sup.ok) {
      set({ state: 'disabled', message: sup.reason });
      return status;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      log.error('updater: ручна перевірка впала', e);
      set({ state: 'error', message: String((e as Error)?.message ?? e) });
    }
    return status;
  });
  ipcMain.handle('update:install', () => {
    if (status.state !== 'downloaded') return false;
    log.info('updater: quitAndInstall (silent) за запитом рендера');
    // setImmediate — дати IPC відповісти до виходу процесу.
    // quitAndInstall(isSilent=true, isForceRunAfter=true): тихе встановлення (NSIS `/S`,
    // БЕЗ майстра-інсталятора) + примусовий перезапуск після. Без прапора isSilent
    // electron-updater запускає NSIS із повним UI — користувач бачив «майстер установки»
    // і помилку «не вдалося закрити Meet Editor». perMachine:false (per-user) → тихе
    // встановлення без UAC. Сам апдейтер закриває застосунок, тож гонки із закриттям нема.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  });

  const sup = updatesSupported();
  if (!sup.ok) {
    log.info('updater: вимкнено —', sup.reason);
    set({ state: 'disabled', message: sup.reason });
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true; // тихе фонове завантаження доступного оновлення
  autoUpdater.autoInstallOnAppQuit = true; // застосувати при наступному виході (як страховка до «Перезапустити»)

  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    autoUpdater.addAuthHeader(`token ${token}`); // приватний репо: авторизація фіда + завантаження ассетів
    log.info('updater: токен присутній — приватний репо доступний');
  } else {
    log.warn('updater: GH_TOKEN відсутній — приватний репо віддасть 404 (задай токен у .env)');
  }

  autoUpdater.on('checking-for-update', () => {
    log.info('updater: перевірка');
    set({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    log.info('updater: доступне', info?.version);
    set({ state: 'available', version: info?.version, percent: 0, message: undefined });
  });
  autoUpdater.on('update-not-available', () => {
    log.info('updater: оновлень немає');
    set({ state: 'not-available', message: undefined });
  });
  autoUpdater.on('download-progress', (p) => {
    set({ state: 'downloading', percent: Math.round(p?.percent ?? 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('updater: завантажено', info?.version);
    set({ state: 'downloaded', version: info?.version, percent: 100, message: undefined });
  });
  autoUpdater.on('error', (e) => {
    log.error('updater error:', e);
    set({ state: 'error', message: String((e as Error)?.message ?? e) });
  });

  // Перша перевірка — з невеликою затримкою (не блокувати старт вікна), далі — періодично.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => log.error('updater: стартова перевірка впала', e));
  }, FIRST_CHECK_DELAY_MS);
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch((e) => log.error('updater: періодична перевірка впала', e));
  }, CHECK_INTERVAL_MS);
}
