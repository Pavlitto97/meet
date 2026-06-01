/**
 * Авто-апдейт через electron-updater (GitHub Releases приватного репо) + electron-log.
 * Windows: оновлення працює (NSIS, навіть без підпису). macOS: Squirrel.Mac відмовляє
 * непідписаним — поки пропускаємо (рішення проєкту), тож на mac це лог-нооп при помилці.
 * Логи апдейтів лягають у ~/Library/Logs/<app> (mac) / %APPDATA%/<app>/logs (win).
 */
import { app, BrowserWindow } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

export function initUpdater(): void {
  log.transports.file.level = 'info';
  if (!app.isPackaged) {
    log.info('updater: пропущено (dev-режим — апдейти не працюють із npm start)');
    return;
  }
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const notify = (channel: string, payload?: unknown) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('checking-for-update', () => log.info('updater: перевірка оновлень'));
  autoUpdater.on('update-available', (info) => { log.info('updater: доступне оновлення', info?.version); notify('update:available', { version: info?.version }); });
  autoUpdater.on('update-not-available', () => log.info('updater: оновлень немає'));
  autoUpdater.on('download-progress', (p) => notify('update:progress', { percent: p?.percent }));
  autoUpdater.on('update-downloaded', (info) => { log.info('updater: завантажено', info?.version); notify('update:downloaded', { version: info?.version }); });
  autoUpdater.on('error', (e) => log.error('updater error:', e));

  try {
    void autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    log.error('updater: checkForUpdates кинув', e);
  }
}
