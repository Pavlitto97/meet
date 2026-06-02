import { test, expect, _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// Smoke-тест: піднімаємо ЗІБРАНИЙ застосунок (out/main/index.js — package.json "main")
// через args:['.'] і перевіряємо, що головне вікно відкривається й Vue-SPA монтується.
// Білд робить скрипт test:e2e (npm run build && playwright test) — args:['.'] запускає
// саме компіляцію, а не src/. electron-builder/інсталятор для тестів НЕ потрібен.
let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  // E2E=1 → main-процес пропускає завантаження DevTools-розширення (без мережі/флаку).
  // ELECTRON_RUN_AS_NODE прибираємо: якщо воно лишиться в середовищі (деякі sandbox/CI
  // його виставляють), Electron-бінарник стартує як чистий Node — без GUI/protocol,
  // і Playwright не зможе підняти вікно. Видалення гарантує запуск повноцінного Electron.
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') childEnv[k] = v;
  }
  childEnv.E2E = '1';
  app = await electron.launch({ args: ['.'], env: childEnv });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('головне вікно відкривається з редактором Meet', async () => {
  // <title>Meet</title> статично, hash-роут /editor виставляє "Meet — редактор" —
  // обидва підходять під /Meet/. На URL не асертимо (роут у фрагменті #/editor).
  await expect(win).toHaveTitle(/Meet/);

  // Vue змонтувався у #app і router-view щось відрендерив.
  const appRoot = win.locator('#app');
  await expect(appRoot).toBeVisible();
  await expect(appRoot).not.toBeEmpty();

  // Рендер віддається кастомним протоколом app:// (а не file://) — це і є «справжній» застосунок.
  const url = await win.evaluate(() => location.href);
  expect(url).toContain('app://meet/index.html');
});
