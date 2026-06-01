/**
 * Точка входу main-процесу (заміна server.php/router.php).
 * Реєструє привілейований app://, ініціалізує БД, відкриває вікно редактора,
 * піднімає авто-апдейтер. Дані — у app.getPath('userData').
 */
import './quiet'; // приглушити node:sqlite ExperimentalWarning — мусить бути ПЕРШИМ
import { app, BrowserWindow, protocol } from 'electron';
import path from 'node:path';
import dotenv from 'dotenv';
import log from 'electron-log';
import { envPath } from './services/paths';
import { initDb } from './services/db';
import { registerAppProtocol } from './protocol';
import { initUpdater } from './updater';
import './routes'; // side-effect: реєстрація всіх маршрутів

// Привілейований кастомний scheme мусить бути зареєстрований ДО app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    backgroundColor: '#202124',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    },
  });
  // Перегляд рендера (window.open('/api/render?...')) → нове вікно того ж origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    return url.startsWith('app://') ? { action: 'allow' } : { action: 'deny' };
  });
  void win.loadURL('app://meet/editor.html');
  return win;
}

app.whenReady().then(() => {
  dotenv.config({ path: envPath() }); // креди з .env (до initDb, що сидить ключ із env)
  log.info('Meet Editor starting', { version: app.getVersion(), packaged: app.isPackaged });
  registerAppProtocol();
  initDb();
  createWindow();
  initUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
