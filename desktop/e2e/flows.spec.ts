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

  // Перехід у деталі групи: 11 дефолтних слотів (8 редагованих + 3 пропущених
  // з плитки «Ще 3 особи» шаблону mqy-kiph-fci).
  await expect(win.locator('.group-title')).toContainText('Тестова група');
  await expect(win.locator('table.data tbody tr')).toHaveCount(11);
  await expect(win.locator('table.data tbody tr.skipped')).toHaveCount(3);

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

test('слайд: завантаження вставляє зображення у презентацію рендеру', async () => {
  const win = launched.win;
  const png = await testPngBuffer();
  const [chooser] = await Promise.all([
    win.waitForEvent('filechooser'),
    win.getByRole('button', { name: /авантажити слайд|амінити слайд/ }).click(),
  ]);
  await chooser.setFiles({ name: 'slide.png', mimeType: 'image/png', buffer: png });
  await expect(win.locator('img.slide-thumb')).toBeVisible();

  // Рендер активної групи: <video data-uid="100"> замінено на <img> зі слайдом.
  const probes = await win.evaluate(async () => {
    const r = await fetch('/api/render?which=start');
    const html = await r.text();
    return {
      hasVideo: html.includes('data-uid="100"'),
      hasSlideImg: html.includes('object-fit: contain'),
    };
  });
  expect(probes.hasVideo).toBe(false);
  expect(probes.hasSlideImg).toBe(true);
});

test('слайд: скріншот усього міта авто-кропається до області презентації', async () => {
  const win = launched.win;
  // Синтетичний «скріншот міта»: темний UI 1600×800 + біла сторінка документа
  // 700×450 @ (200,150) + дрібні світлі плями (плитки/іконки) поза нею.
  const sharp = (await import('sharp')).default;
  const fake = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#202124' } })
    .composite([
      { input: await sharp({ create: { width: 700, height: 450, channels: 3, background: '#ffffff' } }).png().toBuffer(), left: 200, top: 150 },
      { input: await sharp({ create: { width: 120, height: 60, channels: 3, background: '#e8eaed' } }).png().toBuffer(), left: 1300, top: 80 },
      { input: await sharp({ create: { width: 90, height: 90, channels: 3, background: '#dddddd' } }).png().toBuffer(), left: 1100, top: 600 },
    ])
    .png()
    .toBuffer();

  const res = await win.evaluate(async (b64) => {
    const r = await fetch('/api/groups/1/slide', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide_data_url: 'data:image/png;base64,' + b64 }),
    });
    return await r.json();
  }, fake.toString('base64'));
  expect(res.cropped).toBe(1);

  // Збережений слайд = біла сторінка (~700×450), а не весь кадр 1600×800.
  const dims = await win.evaluate(async () => {
    const r = await fetch('/api/groups/1/slide');
    const blob = await r.blob();
    const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height };
  });
  expect(Math.abs(dims.w - 700)).toBeLessThanOrEqual(12);
  expect(Math.abs(dims.h - 450)).toBeLessThanOrEqual(12);

  // Звичайний слайд (світлий на весь кадр) кропом не чіпається.
  const plain = await sharp({ create: { width: 1200, height: 700, channels: 3, background: '#fafafa' } }).png().toBuffer();
  const res2 = await win.evaluate(async (b64) => {
    const r = await fetch('/api/groups/1/slide', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide_data_url: 'data:image/png;base64,' + b64 }),
    });
    return await r.json();
  }, plain.toString('base64'));
  expect(res2.cropped).toBe(0);
});

test('панель «Люди»: фото не показується — завжди літера (фото лише у плитці)', async () => {
  const win = launched.win;
  const probe = await win.evaluate(async () => {
    const groups = await (await fetch('/api/groups')).json();
    const active = groups.find((g: any) => g.active)!.id;
    const ps = await (await fetch('/api/participants?group=' + active)).json();
    const target = ps.find((p: any) => !p.user_added && !p.skipped)!;
    // «Фото»: канвас-портрет 60×80.
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#cc3344';
    ctx.fillRect(0, 0, 60, 80);
    await fetch('/api/participants/' + target.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatar_data_url: canvas.toDataURL('image/png') }),
    });
    const html = await (await fetch('/api/render?which=start')).text();
    // Жоден малий кружечок (панель KjWwNd / бейдж Qw4c9e / «Ще N» qg7mD) не
    // має растрового data:-URL — лише SVG-літери (class↔src у будь-якому порядку).
    const rasterSmall =
      [...html.matchAll(/<img\b[^>]*class="[^"]*(?:KjWwNd|Qw4c9e|qg7mD)[^"]*"[^>]*src="data:image\/(?!svg)/g)].length +
      [...html.matchAll(/<img\b[^>]*src="data:image\/(?!svg)[^"]*"[^>]*class="[^"]*(?:KjWwNd|Qw4c9e|qg7mD)[^"]*"/g)].length;
    // А плитка той самий момент ПОКАЗУЄ фото (растровий data:).
    const tilePhoto =
      /<img\b[^>]*class="[^"]*(?:m0DVAf|SOQwsf)[^"]*"[^>]*src="data:image\/(?!svg)/.test(html) ||
      /<img\b[^>]*src="data:image\/(?!svg)[^"]*"[^>]*class="[^"]*(?:m0DVAf|SOQwsf)[^"]*"/.test(html);
    return { rasterSmall, tilePhoto };
  });
  expect(probe.rasterSmall).toBe(0);
  expect(probe.tilePhoto).toBe(true);
});

test('учасники: видалення дефолтного слота і відновлення', async () => {
  const win = launched.win;
  const rows = win.locator('table.data tbody tr');
  await expect(rows).toHaveCount(11);

  // Видаляємо третій рядок (не першого — його перейменування перевіряє рендер-тест).
  await rows.nth(2).locator('button[title="видалити (можна відновити)"]').click();
  await win.getByRole('button', { name: 'Видалити', exact: true }).click();
  await expect(rows).toHaveCount(10);

  // Слот у секції видалених; відновлення повертає його у список.
  const block = win.locator('.deleted-block');
  await expect(block).toBeVisible();
  await block.getByRole('button', { name: 'Відновити' }).click();
  await expect(rows).toHaveCount(11);
  await expect(win.locator('.deleted-block')).toHaveCount(0);
});

test('скріни: капчер початку зустрічі зʼявляється в історії з назвою групи', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Скріни' }).click();
  // Локатор закріплений за текстом вкладки скрінів: на сторінці групи тепер
  // кілька .hint (зокрема слайд-картка) — голий '.hint' ловив strict violation.
  await expect(win.locator('.hint', { hasText: 'Скрін знімається' })).toContainText('Тестова група');

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

test('налаштування: окрема плашка «API-токени», час — 24-годинний', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Налаштування' }).click();
  const tokens = win.locator('.card-tokens');
  await expect(tokens.locator('h3')).toContainText('API-токени');
  await expect(tokens.locator('#s-key')).toBeVisible();
  // .env комітнутий у репо і сідить ключ у БД — статус «збережено».
  await expect(tokens.locator('.status')).toBeVisible();

  // Час без AM/PM: дефолт «13:41» (24-год формат, як в Україні).
  const timeInput = win.locator('.field input.flatpickr-input').first();
  await expect(timeInput).toHaveValue(/^\d{2}:\d{2}$/);
  await expect(timeInput).toHaveValue('13:41');
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
