import { test, expect } from '@playwright/test';
import { launchApp, closeApp, testPngBuffer, type LaunchedApp } from './helpers';

// Наскрізні UI-флоу БЕЗ звертань до OpenRouter (грошей не витрачає):
// групи (CRUD/активація) → учасники (source-аплоад) → прев'ю рендеру → скрін → налаштування.
test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await closeApp(launched);
});

test('групи: дефолтна «Група 1» існує і активна', async () => {
  const win = launched.win;
  const card = win.locator('.group-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.group-name')).toHaveText('Група 1');
  await expect(card.locator('.badge.done')).toHaveText('активна');
});

test('групи: створення нової групи відкриває її учасників', async () => {
  const win = launched.win;
  await win.getByRole('button', { name: 'Створити групу' }).click();
  await win.locator('.modal-input').fill('Тестова група');
  await win.getByRole('button', { name: 'Створити', exact: true }).click();

  // Перехід у деталі групи: 11 дефолтних слотів (7 редагованих + 4 пропущених).
  await expect(win.locator('.group-title')).toContainText('Тестова група');
  await expect(win.locator('table.data tbody tr')).toHaveCount(11);
  await expect(win.locator('table.data tbody tr.skipped')).toHaveCount(4);

  // Нова група ще не активна — кнопка активації видима.
  await expect(win.getByRole('button', { name: 'Активувати' })).toBeVisible();
});

test('учасники: без оригіналу кнопка «Генерувати» вимкнена', async () => {
  const win = launched.win;
  const firstRow = win.locator('table.data tbody tr').first();
  await expect(firstRow.getByRole('button', { name: 'Генерувати' })).toBeDisabled();
  await expect(win.getByRole('button', { name: /Згенерувати всім \(0\)/ })).toBeDisabled();
});

test('учасники: аплоад оригіналу першому учаснику', async () => {
  const win = launched.win;
  const firstRow = win.locator('table.data tbody tr').first();

  const png = await testPngBuffer();
  // Клік «завантажити оригінал» → діалог підміняємо setInputFiles на прихованому інпуті.
  const [chooser] = await Promise.all([
    win.waitForEvent('filechooser'),
    firstRow.locator('button[title="завантажити/замінити оригінал"]').click(),
  ]);
  await chooser.setFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: png });

  // Source-мініатюра зʼявилась, генерація стала доступною.
  await expect(firstRow.locator('img.thumb.tall')).toBeVisible();
  await expect(firstRow.getByRole('button', { name: 'Генерувати' })).toBeEnabled();
  // Лічильник у кнопці «Згенерувати всім (1)».
  await expect(win.getByRole('button', { name: /Згенерувати всім \(1\)/ })).toBeVisible();
});

test('учасники: перейменування зберігається', async () => {
  const win = launched.win;
  const firstRow = win.locator('table.data tbody tr').first();
  await firstRow.locator('input.i-name').fill('Тарас Тестовий');
  await firstRow.locator('input.i-name').blur();
  await expect(win.locator('.toast')).toContainText('Збережено');

  await win.getByRole('button', { name: 'Оновити' }).click();
  await expect(firstRow.locator('input.i-name')).toHaveValue('Тарас Тестовий');
});

test('активація групи: рендер береться з активної групи', async () => {
  const win = launched.win;
  await win.getByRole('button', { name: 'Активувати' }).click();
  await expect(win.locator('.toast')).toContainText('активна');
  await expect(win.locator('.badge.done', { hasText: 'активна' })).toBeVisible();

  // Рендер містить замінене імʼя АКТИВНОЇ групи (заміна імен — байтова, глобальна).
  const html = await win.evaluate(async () => {
    const r = await fetch('/api/render?which=start');
    return (await r.text()).slice(0, 3_500_000);
  });
  expect(html).toContain('Тарас Тестовий');
});

test('хедер: «Початок зустрічі» відкриває вікно рендеру', async () => {
  const win = launched.win;
  const [popup] = await Promise.all([
    launched.app.waitForEvent('window'),
    win.locator('.admin-head .links').getByText('Початок зустрічі').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toContain('/api/render?which=start');
  await popup.close();
});

test('скріни: капчер початку зустрічі зʼявляється в історії з назвою групи', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Скріни' }).click();
  await expect(win.locator('.hint')).toContainText('Тестова група');

  await win.getByRole('button', { name: 'Скріншот початку зустрічі' }).click();
  // Скрін ≈ 2-4 с (offscreen-рендер + paint).
  await expect(win.locator('.shot-card')).toHaveCount(1, { timeout: 30_000 });
  await expect(win.locator('.shot-card .badge.done')).toHaveText('початок');
  await expect(win.locator('.shot-card .original')).toContainText('Тестова група');
});

test('генерації: фільтр за групою працює (порожньо без генерацій)', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Генерації' }).click();
  const groupFilter = win.locator('.toolbar select').first();
  await expect(groupFilter.locator('option')).toHaveText(['усі групи', 'Група 1', 'Тестова група']);
  await expect(win.locator('.gen-gallery .slot')).toHaveCount(0);
});

test('налаштування: окрема плашка «API-токени»', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Налаштування' }).click();
  const tokens = win.locator('.card-tokens');
  await expect(tokens.locator('h3')).toContainText('API-токени');
  await expect(tokens.locator('#s-key')).toBeVisible();
  // .env комітнутий у репо і сідить ключ у БД — статус «збережено».
  await expect(tokens.locator('.status')).toBeVisible();
});

test('групи: видалення тестової групи переключає активну назад', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Групи' }).click();
  await expect(win.locator('.group-card')).toHaveCount(2);

  const testCard = win.locator('.group-card', { hasText: 'Тестова група' });
  await testCard.locator('button[title="видалити групу"]').click();
  await win.getByRole('button', { name: 'Видалити', exact: true }).click();

  await expect(win.locator('.group-card')).toHaveCount(1);
  // Активність самолікується на першу наявну групу.
  await expect(win.locator('.group-card .badge.done')).toHaveText('активна');
  // Останню групу видалити не можна — кнопки видалення немає.
  await expect(win.locator('.group-card button[title="видалити групу"]')).toHaveCount(0);
});
