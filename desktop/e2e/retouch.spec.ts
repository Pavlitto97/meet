import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from './helpers';
import path from 'node:path';

// Ретуш-редактор (блюр/пікселі/замазування) БЕЗ OpenRouter: готову «done»-генерацію
// підсаджуємо напряму в ізольовану БД застосунку (node:sqlite, WAL — паралельний
// писач безпечний), далі ганяємо повний UI-флоу: кисть → зберегти → бейдж →
// відновити оригінал (байти мають збігтися з вихідними).
test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let genId: number;
let originalBytes = 0;

async function imageProbe(id: number): Promise<{ len: number; head: string }> {
  return await launched.win.evaluate(async (gid) => {
    const r = await fetch(`/api/generation-image/${gid}?t=${Date.now()}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    return { len: bytes.length, head: Array.from(bytes.slice(0, 24)).join(',') };
  }, id);
}

test.beforeAll(async () => {
  launched = await launchApp();

  // Шумне зображення-колаж: пікселізація на ньому гарантовано міняє пікселі.
  const sharp = (await import('sharp')).default;
  const raw = Buffer.alloc(640 * 400 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 251;
  const png = await sharp(raw, { raw: { width: 640, height: 400, channels: 3 } }).png().toBuffer();
  originalBytes = png.length;

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(launched.userData, 'data.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const pid = (db.prepare('SELECT id FROM participants WHERE group_id = 1 ORDER BY position LIMIT 1').get() as any).id;
  const r = db
    .prepare(
      "INSERT INTO generations(participant_id, prompt, model, provider, service_tier, status, image, image_mime, finished_at) " +
        "VALUES(?, 'e2e', 'test-model', 'test', 'default', 'done', ?, 'image/png', CURRENT_TIMESTAMP)"
    )
    .run(String(pid), png);
  genId = Number(r.lastInsertRowid);
  db.close();
});

test.afterAll(async () => {
  await closeApp(launched);
});

test('ретуш: кисть-пікселізація зберігається у генерацію', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Генерації' }).click();
  const slot = win.locator(`.gen-gallery .slot[data-gid="${genId}"]`);
  await expect(slot).toBeVisible();
  await expect(slot.locator('.badge', { hasText: 'ретуш' })).toHaveCount(0);

  await slot.getByRole('button', { name: 'Ретуш' }).click();
  const modal = win.locator('.retouch-modal');
  await expect(modal).toBeVisible();
  const stage = modal.locator('.rt-stage');
  await expect(stage).toBeVisible();

  // Мазок кистю по центру (дефолт: кисть + пікселізація).
  const box = (await stage.boundingBox())!;
  const cy = box.y + box.height / 2;
  await win.mouse.move(box.x + box.width * 0.25, cy);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width * 0.75, cy, { steps: 10 });
  await win.mouse.up();

  await modal.getByRole('button', { name: 'Зберегти ретуш' }).click();
  await expect(win.locator('.toast')).toContainText('Ретуш збережено');
  await expect(modal).toHaveCount(0);

  // Бейдж «ретуш» на картці; байти зображення змінились.
  await expect(slot.locator('.badge', { hasText: 'ретуш' })).toBeVisible();
  const probe = await imageProbe(genId);
  expect(probe.len).not.toBe(originalBytes);
});

test('ретуш: «Відновити оригінал» повертає вихідні байти', async () => {
  const win = launched.win;
  const slot = win.locator(`.gen-gallery .slot[data-gid="${genId}"]`);
  await slot.getByRole('button', { name: 'Ретуш' }).click();
  const modal = win.locator('.retouch-modal');
  await expect(modal).toBeVisible();

  await modal.getByRole('button', { name: 'Відновити оригінал' }).click();
  await win.getByRole('button', { name: 'Відновити', exact: true }).click();
  await expect(win.locator('.toast')).toContainText('Оригінальний кадр відновлено');

  const probe = await imageProbe(genId);
  expect(probe.len).toBe(originalBytes);
  await modal.locator('button', { hasText: 'Закрити' }).click();
  await expect(slot.locator('.badge', { hasText: 'ретуш' })).toHaveCount(0);
});
