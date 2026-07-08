import { test, expect } from '@playwright/test';
import { launchApp, closeApp, testPngBuffer, gotoGroupList, type LaunchedApp } from './helpers';

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
  await gotoGroupList(win); // вкладка авто-перекидає на активну групу → список через ?list=1
  const card = win.locator('.group-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.group-name')).toHaveText('Група 1');
  await expect(card.locator('.badge.done')).toHaveText('активна');
});

test('групи: створення нової групи відкриває її учасників', async () => {
  const win = launched.win;
  await gotoGroupList(win);
  await win.getByRole('button', { name: 'Створити групу' }).click();
  await win.locator('.modal-input').fill('Тестова група');
  await win.getByRole('button', { name: 'Створити', exact: true }).click();

  // Перехід у деталі групи: 11 дефолтних слотів, ЖОДЕН не пропущений (пропуск —
  // суто користувацький прапор; за замовчуванням усі йдуть у рендер).
  await expect(win.locator('.group-title')).toContainText('Тестова група');
  await expect(win.locator('table.data tbody tr')).toHaveCount(11);
  await expect(win.locator('table.data tbody tr.skipped')).toHaveCount(0);

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

test('видалення ущільнює слоти: видалений зник, «Ще N осіб» лишається з 2 кружечками', async () => {
  const win = launched.win;
  const SPACE = 'spaces/A6_qfu4mFcwB';

  // Жертва — будь-який НЕ-Sandro учасник (Sandro закріплений). Беремо останнього
  // не-доданого-вручну (це слот плитки «Ще N осіб»). Даємо унікальне ім'я, щоб
  // однозначно перевірити зникнення.
  const before = await win.evaluate(async () => {
    const groups = await (await fetch('/api/groups')).json();
    const active = groups.find((g: any) => g.active).id;
    const ps = await (await fetch('/api/participants?group=' + active)).json();
    const victim = [...ps].reverse().find((p: any) => !p.user_added && !/devices\/316$/.test(p.device_id));
    await fetch('/api/participants/' + victim.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_name: 'ZZUNIQVICTIM' }),
    });
    const html = await (await fetch('/api/render?which=start')).text();
    return {
      victimId: victim.id,
      present: html.includes('ZZUNIQVICTIM'),
      label3: html.includes('Ще 3 особи'),
      badge12: html.includes('<div class="fs3avc">12</div>'),
      panel12: html.includes('<div class="MKVSQd">12</div>'),
    };
  });
  expect(before.present).toBe(true);
  expect(before.label3).toBe(true);
  expect(before.badge12).toBe(true);
  expect(before.panel12).toBe(true);

  // Видаляємо → ущільнення: видалений зникає, решта зсуваються, останній слот
  // «Ще N осіб» (307) стає порожнім і ховається, плитка лишається з 2 кружечками.
  const after = await win.evaluate(
    async (v) => {
      await fetch('/api/participants/' + v.victimId, { method: 'DELETE' });
      const html = await (await fetch('/api/render?which=start')).text();
      const circles = [...html.matchAll(/<img\b[^>]*?class="[^"]*qg7mD[^"]*"[^>]*?>/g)].map((m) => m[0]);
      return {
        gone: !html.includes('ZZUNIQVICTIM'),
        othersTileHidden: html.includes('.dkjMxf:has(img.qg7mD)'), // НЕ має ховатись цілком
        circlesData: circles.filter((t) => /src="data:/.test(t)).length,
        trailingSlotHidden:
          html.includes('[role="listitem"][data-participant-id="' + v.SPACE + '/devices/307"]') &&
          html.includes('display:none!important'),
        label2: html.includes('Ще 2 особи'),
        label3gone: !html.includes('Ще 3 особи'),
        badge11: html.includes('<div class="fs3avc">11</div>'),
        panel11: html.includes('<div class="MKVSQd">11</div>'),
      };
    },
    { victimId: before.victimId, SPACE }
  );
  expect(after.gone).toBe(true); // видалений учасник зник із рендеру
  expect(after.othersTileHidden).toBe(false); // плитка «Ще N осіб» лишається
  expect(after.circlesData).toBe(2); // 2 кружечки (ущільнено), не один
  expect(after.trailingSlotHidden).toBe(true); // зайвий (останній) слот прихований
  expect(after.label2).toBe(true); // «Ще 3 особи» → «Ще 2 особи»
  expect(after.label3gone).toBe(true);
  expect(after.badge11).toBe(true); // бейдж «Люди»: 12 → 11
  expect(after.panel11).toBe(true); // «Співавтори»: 12 → 11

  // Прибираємо за собою (наступний тест чекає 11 рядків).
  await win.evaluate(async (id) => {
    await fetch('/api/participants/' + id + '/restore', { method: 'POST' });
  }, before.victimId);
});

test('сортування: підняття учасника переміщує його фото у відповідну плитку', async () => {
  const win = launched.win;
  const r = await win.evaluate(async (SPACE) => {
    // Чи містить регіон ПЛИТКИ слота <dev> (від його data-participant-id до
    // наступного) задане ім'я. Рендер замінює шаблонне ім'я слота на ім'я
    // призначеного учасника, тож так перевіряємо, ХТО зараз у цій плитці.
    const tileHasName = (html: string, dev: string, name: string) => {
      const a = html.indexOf('data-participant-id="' + SPACE + '/devices/' + dev + '"');
      if (a < 0) return false;
      const b = html.indexOf('data-participant-id="', a + 30);
      return html.slice(a, b < 0 ? a + 4000 : b).includes(name);
    };
    const groups = await (await fetch('/api/groups')).json();
    const active = groups.find((g: any) => g.active).id;
    const ps = await (await fetch('/api/participants?group=' + active)).json();
    const nonSandro = ps.filter((p: any) => !/devices\/316$/.test(p.device_id)); // за position
    const last = nonSandro[nonSandro.length - 1]; // зараз у «Ще N осіб» (без плитки-фото)
    await fetch('/api/participants/' + last.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_name: 'ZZMOVER' }),
    });
    const htmlBefore = await (await fetch('/api/render?which=start')).text();
    const inFirstTileBefore = tileHasName(htmlBefore, '295', 'ZZMOVER');

    // Піднімаємо last на самий верх → стає першим не-Sandro → слот 295 (перша плитка).
    const order = [last.id, ...ps.filter((p: any) => p.id !== last.id).map((p: any) => p.id)];
    await fetch('/api/participants/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: active, order }),
    });
    const htmlAfter = await (await fetch('/api/render?which=start')).text();
    const inFirstTileAfter = tileHasName(htmlAfter, '295', 'ZZMOVER');
    return { inFirstTileBefore, inFirstTileAfter };
  }, 'spaces/A6_qfu4mFcwB');

  expect(r.inFirstTileBefore).toBe(false); // спершу фото НЕ в першій плитці
  expect(r.inFirstTileAfter).toBe(true); // після підняття — у першій плитці (295)
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

test('скріни: пресет розміру памʼятається між перемиканнями вкладок', async () => {
  const win = launched.win;
  await win.locator('.tabs .tab', { hasText: 'Скріни' }).click();
  const sizeSelect = win.locator('.panel.active .toolbar select');
  await expect(sizeSelect).toBeVisible();

  // Міняємо на не-дефолтний пресет.
  await sizeSelect.selectOption('1280x635');
  await expect(sizeSelect).toHaveValue('1280x635');

  // Ідемо на іншу вкладку і назад — пресет НЕ має скидатись на дефолт.
  await win.locator('.tabs .tab', { hasText: 'Групи' }).click();
  await win.locator('.tabs .tab', { hasText: 'Скріни' }).click();
  await expect(win.locator('.panel.active .toolbar select')).toHaveValue('1280x635');

  // Повертаємо дефолт, щоб не впливати на наступні тести.
  await win.locator('.panel.active .toolbar select').selectOption('2555x1267');
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
  await gotoGroupList(win);
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
