import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, testPngBuffer, type LaunchedApp } from './helpers';

/** Реальне фото для identity-референсу (E2E_LIVE_PHOTO=/шлях.jpg), інакше синтетика. */
async function livePhoto(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const p = process.env.E2E_LIVE_PHOTO;
  if (p && fs.existsSync(p)) {
    const mime = p.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return { name: 'photo' + (mime === 'image/png' ? '.png' : '.jpg'), mimeType: mime, buffer: fs.readFileSync(p) };
  }
  return { name: 'portrait.png', mimeType: 'image/png', buffer: await testPngBuffer() };
}

// ЖИВИЙ конвеєр: реальна AI-генерація через OpenRouter (ВИТРАЧАЄ ГРОШІ).
// Ключ більше НЕ лежить у desktop/.env — передай його через оточення:
//   E2E_LIVE=1 OPENROUTER_API_KEY=sk-or-... npm run test:e2e -- live-generation
// (dotenv не перетирає вже задану змінну, тож db.ts засідить її в ізольовану тест-БД.)
// На CI не виконується (E2E_LIVE не виставлено).
test.describe.configure({ mode: 'serial' });
test.skip(!process.env.E2E_LIVE, 'live-генерація вмикається лише E2E_LIVE=1 (коштує грошей)');

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await closeApp(launched);
});

test('повний цикл: оригінал → AI-генерація → застосувати → рендер з аватарками', async () => {
  test.setTimeout(360_000); // генерація може йти кілька хвилин (flex-тариф)
  const win = launched.win;

  // Опційний оверрайд провайдера/тарифу (E2E_LIVE_PROVIDER=google-vertex
  // E2E_LIVE_TIER=default), якщо дефолтний google-ai-studio тимчасово
  // rate-limited upstream (vertex не підтримує flex-тариф для цієї моделі).
  const overrides: Record<string, string> = {};
  if (process.env.E2E_LIVE_PROVIDER) overrides.gen_provider = process.env.E2E_LIVE_PROVIDER;
  if (process.env.E2E_LIVE_TIER) overrides.gen_tier = process.env.E2E_LIVE_TIER;
  if (Object.keys(overrides).length) {
    await win.evaluate(async (body) => {
      await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }, overrides);
  }

  // 1. Зайти у дефолтну групу, завантажити оригінал першому учаснику.
  await win.locator('.group-card').first().click();
  const firstRow = win.locator('table.data tbody tr').first();
  const [chooser] = await Promise.all([
    win.waitForEvent('filechooser'),
    firstRow.locator('button[title="завантажити/замінити оригінал"]').click(),
  ]);
  await chooser.setFiles(await livePhoto());
  await expect(firstRow.locator('img.thumb.tall')).toBeVisible();

  // 2. Стартувати генерацію.
  await firstRow.getByRole('button', { name: 'Генерувати' }).click();
  await expect(win.locator('.toast')).toContainText('Генерація');

  // 3. Вкладка «Генерації»: картка з'явилась, чекаємо «готово» (полінг кожні 2.5с вбудований).
  await win.locator('.tabs .tab', { hasText: 'Генерації' }).click();
  const card = win.locator('.gen-gallery .slot').first();
  await expect(card).toBeVisible();
  // Видно групу, учасника і оригінал (source-прев'ю).
  await expect(card.locator('.badge.group')).toBeVisible();
  await expect(card.locator('.gen-compare img').first()).toBeVisible();
  await expect(card.locator('.badge', { hasText: /готово|порожньо|помилка/ })).toBeVisible({ timeout: 300_000 });

  const badgeText = await card.locator('.queue-head .badge').nth(1).textContent();
  expect(badgeText).toContain('готово');

  // 4. Застосувати: колаж ріжеться на початок/кінець, історія лишається з бейджем.
  await card.getByRole('button', { name: 'Застосувати' }).click();
  await expect(win.locator('.toast')).toContainText('Застосовано');
  await expect(card.locator('.badge.applied')).toBeVisible();

  // 5. Учасник отримав обидві аватарки.
  await win.locator('.tabs .tab', { hasText: 'Групи' }).click();
  await win.locator('.group-card').first().click();
  const row = win.locator('table.data tbody tr').first();
  await expect(row.locator('img.thumb:not(.tall)')).toHaveCount(2);

  // 6. Рендер містить data:-аватарки (байти вживлено).
  const hasDataUrl = await win.evaluate(async () => {
    const r = await fetch('/api/render?which=start');
    const t = await r.text();
    return t.includes('src="data:image/');
  });
  expect(hasDataUrl).toBe(true);

  // 7. Ручний кроп: клік по згенерованому зображенню відкриває кроп-в'юер,
  //    область обирається вручну/пресетом і підтверджується «початок»/«кінець».
  await win.locator('.tabs .tab', { hasText: 'Генерації' }).click();
  await win.locator('.gen-gallery .slot').first().locator('.gen-compare .preview').nth(1).click();
  await expect(win.locator('.crop-modal')).toBeVisible();
  await expect(win.locator('.crop-empty-hint')).toBeVisible(); // без автовиділення
  const confirmStart = win.locator('.crop-modal').getByRole('button', { name: 'Початок зустрічі' });
  await expect(confirmStart).toBeDisabled(); // підтвердити нема чого — область не обрана
  await win.locator('.crop-modal').getByRole('button', { name: /Ліва половина|Верхня половина/ }).click();
  await expect(win.locator('.crop-rect')).toBeVisible();
  await confirmStart.click();
  await expect(win.locator('.toast')).toContainText('аватарка початку');
  await win.locator('.crop-modal').getByRole('button', { name: 'Закрити' }).click();

  // 8. Скрін початку і кінця зустрічі.
  await win.locator('.tabs .tab', { hasText: 'Скріни' }).click();
  await win.getByRole('button', { name: 'Скріншот початку зустрічі' }).click();
  await expect(win.locator('.shot-card')).toHaveCount(1, { timeout: 30_000 });
  await win.getByRole('button', { name: 'Скріншот кінця зустрічі' }).click();
  await expect(win.locator('.shot-card')).toHaveCount(2, { timeout: 30_000 });
});
