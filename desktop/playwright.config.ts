import { defineConfig } from '@playwright/test';

// E2E для Electron-додатку. БЕЗ webServer і БЕЗ projects/браузерів — застосунок
// піднімається всередині кожного тесту через _electron.launch (див. e2e/*.spec.ts).
// Одна інстанція Electron за раз: workers=1 / без паралелі, бо всі інстанції
// ділять один SQLite data.db в userData.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000, // білд+старт+перший рендер бувають повільні
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { trace: 'on-first-retry' },
});
