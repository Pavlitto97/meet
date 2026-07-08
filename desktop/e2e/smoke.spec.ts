import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from './helpers';

// Smoke: застосунок піднімається, Vue-SPA монтується на app://, хедер чистий
// (без «Лабораторії» і download HTML), стартова вкладка — «Групи».
let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await closeApp(launched);
});

test('головне вікно відкривається з адмін-панеллю Meet', async () => {
  const win = launched.win;
  await expect(win).toHaveTitle(/Meet/);

  // Vue змонтувався у #app і router-view щось відрендерив.
  const appRoot = win.locator('#app');
  await expect(appRoot).toBeVisible();
  await expect(appRoot).not.toBeEmpty();

  // Рендер віддається кастомним протоколом app:// (а не file://) — це і є «справжній» застосунок.
  const url = await win.evaluate(() => location.href);
  expect(url).toContain('app://meet/index.html');
});

test('хедер: лише зрозумілі кнопки перегляду, без лабораторії і download', async () => {
  const win = launched.win;
  const links = win.locator('.admin-head .links');
  await expect(links.getByText('Початок зустрічі')).toBeVisible();
  await expect(links.getByText('Кінець зустрічі')).toBeVisible();
  await expect(links.getByText('Лабораторія')).toHaveCount(0);
  await expect(links.getByText('HTML')).toHaveCount(0);
});

test('вкладки: Групи (стартова) / Генерації / Скріни / Налаштування / Промт', async () => {
  const win = launched.win;
  const tabs = win.locator('.tabs .tab');
  await expect(tabs).toHaveText(['Групи', 'Генерації', 'Скріни', 'Налаштування', 'Промт']);
  await expect(win.locator('.tab.active')).toHaveText('Групи');
});
