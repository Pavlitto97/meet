import { test, expect } from '@playwright/test';
import { launchApp, closeApp, gotoGroupList, type LaunchedApp } from './helpers';

// Три фічі v0.1.9: авто-редірект вкладки «Групи» на активну групу; учасники понад
// 10 слотів зʼявляються у списку «Люди» (клон-рядки) + лічильник «Ще N осіб»;
// повноекранний перегляд скріна у прев'ю-модалі (клік/Esc).
test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
test.beforeAll(async () => {
  launched = await launchApp();
});
test.afterAll(async () => {
  await closeApp(launched);
});

test('роутинг: вкладка «Групи» авто-відкриває активну групу; «← Групи» показує список', async () => {
  const win = launched.win;
  // На старті активна «Група 1» → одразу детальна сторінка (а не список).
  await expect(win.locator('.group-title')).toContainText('Група 1');
  await expect(win.locator('.group-card')).toHaveCount(0); // список НЕ показано

  // «← Групи» (secondary-кнопка в детальній, НЕ вкладка) → повний список (?list=1).
  await win.locator('button.secondary', { hasText: 'Групи' }).first().click();
  await expect(win.locator('.group-card')).toHaveCount(1);
  await expect(win.getByRole('button', { name: 'Створити групу' })).toBeVisible();

  // Клік на вкладку «Генерації», потім назад на «Групи» → знову детальна активної.
  await win.locator('.tabs .tab', { hasText: 'Генерації' }).click();
  await win.locator('.tabs .tab', { hasText: 'Групи' }).click();
  await expect(win.locator('.group-title')).toContainText('Група 1');
  await expect(win.locator('.group-card')).toHaveCount(0);
});

test('понад 10 учасників: 11-й зʼявляється у списку «Люди» + «Ще 4 особи»', async () => {
  const win = launched.win;
  const probe = await win.evaluate(async () => {
    const groups = await (await fetch('/api/groups')).json();
    const active = groups.find((g: any) => g.active).id;
    // Дефолт: Sandro + 10 не-Sandro. Додаємо 11-го (унікальне ім'я) → надмір (rank 10).
    await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: active, custom_name: 'ОверфлоУнікал' }),
    });
    const html = await (await fetch('/api/render?which=start')).text();
    return {
      activeId: active,
      // Клонований рядок панелі «Люди»: ім'я саме у <span class="zWGUib">.
      inPanelSpan: html.includes('<span class="zWGUib">ОверфлоУнікал</span>'),
      label4: html.includes('Ще 4 особи'),
      badge13: html.includes('<div class="fs3avc">13</div>'),
      panel13: html.includes('<div class="MKVSQd">13</div>'),
    };
  });
  expect(probe.inPanelSpan).toBe(true); // зʼявився як рядок панелі «Люди» (клон)
  expect(probe.label4).toBe(true); // «Ще 3 особи» → «Ще 4 особи»
  expect(probe.badge13).toBe(true); // бейдж «Люди»: 12 → 13
  expect(probe.panel13).toBe(true); // «Співавтори»: 13

  // Прибираємо доданого (user_added → hard delete), щоб не впливати на інші тести.
  await win.evaluate(async (active) => {
    const ps = await (await fetch('/api/participants?group=' + active)).json();
    const v = ps.find((p: any) => p.custom_name === 'ОверфлоУнікал');
    if (v) await fetch('/api/participants/' + v.id, { method: 'DELETE' }); // user_added → видалення назавжди
  }, probe.activeId);
});

test('пропуск: skipped-учасник зникає з рендеру (і повертається при знятті)', async () => {
  const win = launched.win;
  const r = await win.evaluate(async () => {
    const groups = await (await fetch('/api/groups')).json();
    const active = groups.find((g: any) => g.active).id;
    const ps = await (await fetch('/api/participants?group=' + active)).json();
    const victim = ps.find((p: any) => !/devices\/316$/.test(p.device_id) && !p.skipped);
    const orig = victim.custom_name;
    const put = (body: any) =>
      fetch('/api/participants/' + victim.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await put({ custom_name: 'СКІПТЕСТ' });
    const before = await (await fetch('/api/render?which=start')).text();
    await put({ skipped: 1 }); // ← «пропуск»
    const afterSkip = await (await fetch('/api/render?which=start')).text();
    await put({ skipped: 0 }); // знімаємо пропуск
    const afterUnskip = await (await fetch('/api/render?which=start')).text();
    await put({ custom_name: orig ?? '' }); // прибираємо за собою
    return {
      presentBefore: before.includes('СКІПТЕСТ'),
      presentAfterSkip: afterSkip.includes('СКІПТЕСТ'),
      presentAfterUnskip: afterUnskip.includes('СКІПТЕСТ'),
    };
  });
  expect(r.presentBefore).toBe(true); // до пропуску — у рендері
  expect(r.presentAfterSkip).toBe(false); // ← «пропуск» прибирає зі скріна
  expect(r.presentAfterUnskip).toBe(true); // зняли пропуск — знову у рендері
});

test('скріни: превʼю відкривається на весь екран і закривається через Esc', async () => {
  const win = launched.win;
  // Знімаємо скрін активної групи через API (швидко) і оновлюємо вкладку.
  await win.evaluate(async () => {
    await fetch('/api/screenshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ which: 'start', width: 1280, height: 635 }),
    });
  });
  await win.locator('.tabs .tab', { hasText: 'Скріни' }).click();
  await win.getByRole('button', { name: 'Оновити' }).click();
  const card = win.locator('.shot-card').first();
  await expect(card).toBeVisible({ timeout: 30_000 });

  // Відкриваємо прев'ю-модаль (клік на прев'ю картки).
  await card.locator('.preview').click();
  const modal = win.locator('.modal.modal-img');
  await expect(modal).toBeVisible();

  // Клік на зображення → повноекранний оверлей.
  await modal.locator('.gen-preview').click();
  await expect(win.locator('.img-fs')).toBeVisible();

  // Esc → закриває спершу повноекран, модаль лишається.
  await win.keyboard.press('Escape');
  await expect(win.locator('.img-fs')).toHaveCount(0);
  await expect(modal).toBeVisible();

  // Esc ще раз → закриває модаль.
  await win.keyboard.press('Escape');
  await expect(win.locator('.modal-bg.show')).toHaveCount(0);
});
