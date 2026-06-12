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
import { envPath, splashHtmlPath } from './services/paths';
import { initDb } from './services/db';
import { failOrphanedGenerations } from './services/generations';
import { registerAppProtocol } from './protocol';
import { initUpdater } from './updater';
import './routes'; // side-effect: реєстрація всіх маршрутів

// Ізольований userData для E2E/тестів: герметична БД, дев-дані не чіпаються.
if (process.env.MEET_USERDATA) {
  app.setPath('userData', process.env.MEET_USERDATA);
}

// Привілейований кастомний scheme мусить бути зареєстрований ДО app ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Сплеш видно щонайменше стільки, перш ніж зʼявиться головне вікно.
const SPLASH_MIN_MS = 3000;

/**
 * Сплеш-прелоадер: маленьке frameless-вікно з resources/splash.html, показується
 * миттєво при старті. Без preload і без доступу до Node (sandbox) — чистий статичний
 * HTML через file:// (app:// на цей момент ще може бути не зареєстрований).
 */
function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 380,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  splash.once('ready-to-show', () => splash.show());
  void splash.loadFile(splashHtmlPath());
  return splash;
}

function createWindow(opts: { show?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 880,
    backgroundColor: '#202124',
    show: opts.show !== false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    },
  });
  // Перегляд рендера (window.open('/api/render?...')) → нове вікно того ж origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    return url.startsWith('app://') ? { action: 'allow' } : { action: 'deny' };
  });
  // Vue SPA (Vite-білд) із hash-роутингом — єдиний вхід index.html.
  void win.loadURL('app://meet/index.html');
  return win;
}

/**
 * DevTools-розширення (Vue Devtools) — ТІЛЬКИ в dev (`!app.isPackaged`).
 * Ставиться у default-сесію через electron-devtools-installer. Викликаємо БЕЗ await
 * (у фоні, після появи вікна), щоб мережеве завантаження з Chrome Web Store не
 * затримувало старт. Динамічний import + try/catch: пакет не тягнеться у прод-бандл
 * і збій (офлайн/недоступний Chrome Web Store) не валить застосунок.
 *
 * ВАЖЛИВО (обмеження Electron #34386, «not planned»): DevTools-розширення НЕ
 * чіпляються до рендера, що віддається кастомним привілейованим протоколом `app://`
 * — лише http/https (і file:// з allowFileAccess). Оскільки і SPA, і весь /api/*
 * рідерер бере з origin `app://meet`, панель Vue Devtools у поточному dev-флоу не
 * зʼявиться. Інспектор/Console/Network (нативний DevTools-панель нижче) працюють
 * над app:// як завжди. Розширення лишається підключеним і запрацює автоматично,
 * якщо зʼявиться dev-флоу з рендером по http (напр. vite dev server).
 */
async function installDevtools(): Promise<void> {
  try {
    const { installExtension, VUEJS_DEVTOOLS } = await import('electron-devtools-installer');
    const ext = await installExtension(VUEJS_DEVTOOLS, {
      loadExtensionOptions: { allowFileAccess: true },
    });
    log.info('DevTools extension added', { name: ext.name });
  } catch (err) {
    log.warn('Vue Devtools install skipped (dev-only; not attached over app://)', err);
  }
}

app.whenReady().then(async () => {
  dotenv.config({ path: envPath() }); // креди з .env (до initDb, що сидить ключ із env)
  log.info('Meet Editor starting', { version: app.getVersion(), packaged: app.isPackaged });
  // Сплеш — одразу, ще до ініціалізації БД/протоколу. Під E2E вимкнено:
  // Playwright чекає firstWindow() і сплеш ламав би тести (як і DevTools нижче).
  const splash = process.env.E2E ? null : createSplash();
  const splashShownAt = Date.now();
  registerAppProtocol();
  initDb();
  failOrphanedGenerations(); // pending без живого воркера → error (воркер inline у main)
  const win = createWindow({ show: !splash });
  if (splash) {
    // Головне вікно показуємо, коли воно готове І сплеш провисів ≥ SPLASH_MIN_MS.
    win.once('ready-to-show', () => {
      const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - splashShownAt));
      setTimeout(() => {
        if (!splash.isDestroyed()) splash.destroy();
        if (!win.isDestroyed()) win.show();
      }, wait);
    });
  }
  // DevTools лише у локальному dev: не в проді, не під E2E/CI (де installExtension
  // тягнувся б у Chrome Web Store і гальмував/флакав запуск). Вікно вже створене —
  // installDevtools() без await, щоб не блокувати старт на мережі.
  if (!app.isPackaged && !process.env.CI && !process.env.E2E) {
    void installDevtools(); // Vue Devtools у default-сесію (у фоні)
    win.webContents.openDevTools({ mode: 'detach' }); // нативний DevTools (працює над app://)
  }
  initUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
