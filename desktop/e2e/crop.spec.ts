import { test, expect } from '@playwright/test';
import path from 'node:path';
import { launchApp, closeApp, type LaunchedApp } from './helpers';

// Кроп-модалка генерації: драг-виділення мишею, рух/ресайз рамки, підтвердження
// «початок»/«кінець». БЕЗ OpenRouter: готова генерація сідиться напряму в SQLite.
// Колаж 1600×900 (ліва половина ЧЕРВОНА, права СИНЯ) → після кропу перевіряємо
// колір центрального пікселя аватарки — доказ, що мапінг display→natural
// координат і серверний extract геометрично точні.
test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let pid = 0;

const RED = { r: 217, g: 48, b: 37 };
const BLUE = { r: 26, g: 115, b: 232 };

async function collagePng(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const right = await sharp({ create: { width: 800, height: 900, channels: 3, background: BLUE } })
    .png()
    .toBuffer();
  return sharp({ create: { width: 1600, height: 900, channels: 3, background: RED } })
    .composite([{ input: right, left: 800, top: 0 }])
    .png()
    .toBuffer();
}

/** Центральний піксель аватарки учасника (декод у рендері через OffscreenCanvas). */
async function avatarCenterPixel(which: 'start' | 'end'): Promise<{ r: number; g: number; b: number }> {
  return launched.win.evaluate(
    async (arg: { pid: number; which: string }) => {
      const resp = await fetch(`/api/avatar/${arg.pid}?which=${arg.which}&ts=${Date.now()}`);
      if (!resp.ok) throw new Error(`avatar ${arg.which}: HTTP ${resp.status}`);
      const bmp = await createImageBitmap(await resp.blob());
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2), 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    },
    { pid, which }
  );
}

/** Розпарсити `.crop-size` («640×720 px · x 80 · y 90») → числа. */
async function selInfo(): Promise<{ w: number; h: number; x: number; y: number }> {
  const txt = (await launched.win.locator('.crop-size').textContent()) ?? '';
  const m = txt.match(/(\d+)×(\d+) px · x (\d+) · y (\d+)/);
  if (!m) throw new Error(`не розпарсив .crop-size: "${txt}"`);
  return { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) };
}

test.beforeAll(async () => {
  launched = await launchApp();
  // Сід: готова done-генерація з колажем у свіжу e2e-БД (схему створив застосунок).
  const png = await collagePng();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(launched.userData, 'data.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const row = db.prepare('SELECT id FROM participants ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (!row) throw new Error('у e2e-БД немає учасників (сід застосунку не відпрацював)');
  pid = Number(row.id);
  db.prepare(
    'INSERT INTO generations (participant_id, prompt, model, provider, service_tier, status, image, image_mime, finished_at) ' +
      "VALUES (?, 'e2e crop seed', 'test/model', 'test', 'default', 'done', ?, 'image/png', CURRENT_TIMESTAMP)"
  ).run(pid, png);
  db.close();
});

test.afterAll(async () => {
  await closeApp(launched);
});

test('кроп-модалка відкривається і вписується у вікно без внутрішніх скролів', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Генерації' }).click();
  await expect(win.locator('.gen-gallery .slot')).toHaveCount(1);

  await win.getByRole('button', { name: 'Кроп' }).click();
  const modal = win.locator('.modal.crop-modal');
  await expect(modal).toBeVisible();
  // Зображення вписане (v-show=ready після load+refit) + анімація відкриття завершилась.
  await expect(win.locator('.crop-stage')).toBeVisible();
  await win.waitForTimeout(400);

  const fit = await modal.evaluate((el) => ({
    sw: el.scrollWidth,
    cw: el.clientWidth,
    sh: el.scrollHeight,
    ch: el.clientHeight,
  }));
  expect(fit.sw).toBeLessThanOrEqual(fit.cw + 1); // без горизонтального скролу
  expect(fit.sh).toBeLessThanOrEqual(fit.ch + 1); // без вертикального скролу

  const stageBox = (await win.locator('.crop-stage').boundingBox())!;
  const view = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  expect(stageBox.x).toBeGreaterThanOrEqual(0);
  expect(stageBox.y).toBeGreaterThanOrEqual(0);
  expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(view.w + 1);
  expect(stageBox.y + stageBox.height).toBeLessThanOrEqual(view.h + 1);
});

test('драг мишею малює видиму рамку виділення з розмірами', async () => {
  const win = launched.win;
  const stage = win.locator('.crop-stage');
  const box = (await stage.boundingBox())!;

  // Тягнемо з (5%, 10%) до (45%, 90%) — рамка видима ще ПІД ЧАС драгу.
  await win.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.1);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5, { steps: 5 });
  await expect(win.locator('.crop-rect')).toBeVisible();
  await win.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.9, { steps: 5 });
  await win.mouse.up();

  await expect(win.locator('.crop-rect')).toBeVisible();
  await expect(win.locator('.crop-size-badge')).toBeVisible();
  // 40% × 80% від 1600×900 = 640×720 (± похибка цілих екранних пікселів).
  const s = await selInfo();
  expect(Math.abs(s.w - 640)).toBeLessThanOrEqual(16);
  expect(Math.abs(s.h - 720)).toBeLessThanOrEqual(16);
});

test('рамку можна посунути драгом і розтягнути за маркер', async () => {
  const win = launched.win;
  const before = await selInfo();

  // Рух: тягнемо зсередини рамки вправо.
  const rect = (await win.locator('.crop-rect').boundingBox())!;
  await win.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await win.mouse.down();
  await win.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2, { steps: 6 });
  await win.mouse.up();
  const moved = await selInfo();
  expect(moved.x).toBeGreaterThan(before.x);
  expect(Math.abs(moved.w - before.w)).toBeLessThanOrEqual(2); // розмір не змінився

  // Ресайз: тягнемо south-east маркер усередину (зменшення).
  const se = (await win.locator('.crop-h-se').boundingBox())!;
  await win.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await win.mouse.down();
  await win.mouse.move(se.x + se.width / 2 - 50, se.y + se.height / 2 - 40, { steps: 6 });
  await win.mouse.up();
  const resized = await selInfo();
  expect(resized.w).toBeLessThan(moved.w);
  expect(resized.h).toBeLessThan(moved.h);
});

test('підтвердження «Початок зустрічі»: аватарка = вирізана ЧЕРВОНА зона', async () => {
  const win = launched.win;
  const stage = win.locator('.crop-stage');
  const box = (await stage.boundingBox())!;

  // Чисте виділення всередині лівої (червоної) половини: 10%..40% × 15%..85%.
  await win.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.15);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.85, { steps: 6 });
  await win.mouse.up();

  const startBtn = win.locator('.crop-confirm').getByRole('button', { name: 'Початок зустрічі' });
  await startBtn.click();
  await expect(win.locator('.toast').last()).toContainText('початку');
  await expect(startBtn).toHaveClass(/applied/);

  const px = await avatarCenterPixel('start');
  expect(px.r).toBeGreaterThan(170);
  expect(px.g).toBeLessThan(110);
  expect(px.b).toBeLessThan(90);
});

test('пресет «Права половина» + «Кінець зустрічі»: аватарка = СИНЯ зона', async () => {
  const win = launched.win;
  await win.locator('.crop-presets').getByRole('button', { name: 'Права половина' }).click();
  const s = await selInfo();
  expect(s.w).toBe(800);
  expect(s.h).toBe(900);
  expect(s.x).toBe(800);

  const endBtn = win.locator('.crop-confirm').getByRole('button', { name: 'Кінець зустрічі' });
  await endBtn.click();
  await expect(win.locator('.toast').last()).toContainText('кінця');
  await expect(endBtn).toHaveClass(/applied/);

  const px = await avatarCenterPixel('end');
  expect(px.b).toBeGreaterThan(170);
  expect(px.r).toBeLessThan(90);
});

test('після закриття модалки генерація позначена «застосовано»', async () => {
  const win = launched.win;
  await win.locator('.crop-confirm').getByRole('button', { name: 'Закрити' }).click();
  await expect(win.locator('.modal.crop-modal')).toHaveCount(0);
  await expect(win.locator('.gen-gallery .slot .badge.applied')).toHaveText('застосовано');
});
