import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from './helpers';

/**
 * Сценарій (навчальний): видалений учасник зникає з рендеру і лічильник
 * «Люди» синхронізується з кількістю через API.
 *
 *   1. Створюємо «Групу А» і активуємо її.
 *   2. Перейменовуємо першого редагованого учасника на «ТестовийКирило».
 *   3. Перевіряємо baseline: «ТестовийКирило» є у рендері (start + end),
 *      headcount у бейджі «Люди» = кількість учасників через API + 1.
 *   4. Видаляємо «ТестовийКирила» (soft-delete, deleted=1).
 *   5. Перевіряємо, що «ТестовийКирило» зник із рендеру обох варіантів.
 *   6. Перевіряємо, що headcount зменшився рівно на 1 і збігається з API.
 *   7. Знімаємо скріншот початку та кінця зустрічі — обидва зʼявляються в
 *      історії з назвою «Група А».
 *
 * ⚠️  Чому НЕ "Кирило": devices/302 («Кирило», skipped) — скіпований учасник
 *   шаблону; його ім'я вже є у HTML незалежно від видалень. Будь-яка перевірка
 *   html.includes('Кирило') повертатиме true завжди. Для чистоти тесту
 *   використовуємо назву, якої немає у шаблоні.
 *
 * Чому headcount = API-кількість + 1:
 *   render.ts рахує headcount як rows.length + 1, де +1 — Sandro (devices/316),
 *   який дублюється в панелі «Люди» як локальний користувач («ви»).
 *   Шаблон статично показує 12 (= 11 дефолтних слотів + 1).
 *   Після soft-delete учасника render виключає його з вибірки (deleted=0),
 *   тож headcount зменшується синхронно.
 */
test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

// Стан між тестами (sequential → безпечно)
let groupAId = -1;
let initialApiCount = -1;
let initialHeadcount = -1;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await closeApp(launched);
});

// ─── Хелпери ──────────────────────────────────────────────────────────────────

/** Лічильник «Люди» із рендеру (<div class="fs3avc">N</div>). */
async function renderHeadcount(which: 'start' | 'end'): Promise<number> {
  return launched.win.evaluate(async (w: string) => {
    const r = await fetch(`/api/render?which=${w}`);
    const html = await r.text();
    const m = html.match(/<div class="fs3avc">(\d+)<\/div>/);
    return m ? parseInt(m[1], 10) : -1;
  }, which);
}

/** Чи зустрічається ім'я у відповіді /api/render. */
async function nameInRender(name: string, which: 'start' | 'end'): Promise<boolean> {
  return launched.win.evaluate(
    async ({ w, n }: { w: string; n: string }) => {
      const r = await fetch(`/api/render?which=${w}`);
      const html = await r.text();
      return html.includes(n);
    },
    { w: which, n: name }
  );
}

/** Кількість НЕ-видалених учасників групи через API (включно зі skipped). */
async function apiParticipantCount(gid: number): Promise<number> {
  return launched.win.evaluate(async (id: number) => {
    const ps = await (await fetch(`/api/participants?group=${id}`)).json();
    return (ps as unknown[]).length;
  }, gid);
}

// ─── Тести ────────────────────────────────────────────────────────────────────

test('Група А: створення і активація', async () => {
  const win = launched.win;

  await win.getByRole('button', { name: 'Створити групу' }).click();
  await win.locator('.modal-input').fill('Група А');
  await win.getByRole('button', { name: 'Створити', exact: true }).click();

  // Перейшли до GroupDetailTab — заголовок містить назву
  await expect(win.locator('.group-title')).toContainText('Група А');

  // Зберігаємо id, щоб формувати URL-запити в наступних тестах
  groupAId = await win.evaluate(async () => {
    const gs = await (await fetch('/api/groups')).json();
    const g = (gs as { id: number; name: string }[]).find((x) => x.name === 'Група А');
    return g?.id ?? -1;
  });
  expect(groupAId).toBeGreaterThan(0);

  // Активуємо групу — вона стане джерелом для рендеру і скрінів
  await win.getByRole('button', { name: 'Активувати' }).click();
  await expect(win.locator('.badge.done', { hasText: 'активна' })).toBeVisible();
});

test('ТестовийКирило: перейменовуємо першого редагованого учасника', async () => {
  const win = launched.win;

  // Перший НЕ-skipped рядок таблиці учасників (Sandro — position 0)
  const firstEditable = win.locator('table.data tbody tr:not(.skipped)').first();
  await firstEditable.locator('input.i-name').fill('ТестовийКирило');
  await firstEditable.locator('input.i-name').blur();
  await expect(win.locator('.toast')).toContainText('Збережено');
});

test('baseline: ТестовийКирило є у рендері, headcount = API-кількість + 1', async () => {
  const win = launched.win;

  // «ТестовийКирило» — штучна назва, якої немає у шаблоні → гарантує чистоту перевірки
  expect(await nameInRender('ТестовийКирило', 'start')).toBe(true);
  expect(await nameInRender('ТестовийКирило', 'end')).toBe(true);

  // Зчитуємо поточну кількість для порівняння після видалення
  initialApiCount = await apiParticipantCount(groupAId);
  initialHeadcount = await renderHeadcount('start');

  // Headcount = (всі не-deleted) + 1 (Sandro як «ви»)
  expect(initialHeadcount).toBe(initialApiCount + 1);

  // Рендер «кінця» має той самий headcount
  expect(await renderHeadcount('end')).toBe(initialHeadcount);
});

test('ТестовийКирило: видалення з групи (soft-delete)', async () => {
  const win = launched.win;
  const rowsBefore = await win.locator('table.data tbody tr').count();

  const firstEditable = win.locator('table.data tbody tr:not(.skipped)').first();
  await firstEditable.locator('button[title="видалити (можна відновити)"]').click();
  await win.getByRole('button', { name: 'Видалити', exact: true }).click();

  // Рядок зникає з активної таблиці — переходить у .deleted-block
  await expect(win.locator('table.data tbody tr')).toHaveCount(rowsBefore - 1);
  await expect(win.locator('.deleted-block')).toBeVisible();
});

test('після видалення: ТестовийКирило відсутній у рендері початку зустрічі', async () => {
  expect(await nameInRender('ТестовийКирило', 'start')).toBe(false);
});

test('після видалення: ТестовийКирило відсутній у рендері кінця зустрічі', async () => {
  expect(await nameInRender('ТестовийКирило', 'end')).toBe(false);
});

test('headcount зменшився рівно на 1 і збігається з API', async () => {
  const win = launched.win;

  const newApiCount = await apiParticipantCount(groupAId);
  const newHeadcount = await renderHeadcount('start');

  // Один учасник видалено
  expect(newApiCount).toBe(initialApiCount - 1);

  // Headcount = API-кількість + 1 (інваріант незалежно від кількості учасників)
  expect(newHeadcount).toBe(newApiCount + 1);

  // Абсолютна перевірка: headcount впав рівно на 1
  expect(newHeadcount).toBe(initialHeadcount - 1);

  // «Кінець» — той самий headcount
  expect(await renderHeadcount('end')).toBe(newHeadcount);
});

test('скрін початку зустрічі: знімається і зʼявляється в історії з назвою Групи А', async () => {
  const win = launched.win;

  await win.locator('.tabs .tab', { hasText: 'Скріни' }).click();

  // Підказка «Скрін знімається» має містити назву активної групи
  await expect(win.locator('.hint', { hasText: 'Скрін знімається' })).toContainText('Група А');

  await win.getByRole('button', { name: 'Скріншот початку зустрічі' }).click();

  // Знімок готовий — карточка зʼявилась (30 с — Chrome+рендер)
  await expect(win.locator('.shot-card')).toHaveCount(1, { timeout: 30_000 });
  await expect(win.locator('.shot-card .badge.done')).toHaveText('початок');

  // Метадані карточки містять назву активної групи
  await expect(win.locator('.shot-card .original')).toContainText('Група А');
});

test('скрін кінця зустрічі: знімається і зʼявляється в історії', async () => {
  const win = launched.win;

  await win.getByRole('button', { name: 'Скріншот кінця зустрічі' }).click();

  // Другий знімок зʼявляється поряд із першим
  await expect(win.locator('.shot-card')).toHaveCount(2, { timeout: 30_000 });

  // Є хоча б один знімок «кінець» (.badge.pending = стиль для end)
  await expect(win.locator('.shot-card .badge.pending')).toHaveText('кінець');
});

test('cleanup: Група А видаляється, активною стає Група 1', async () => {
  const win = launched.win;

  // Переходимо до списку груп
  await win.locator('.tabs .tab', { hasText: 'Групи' }).click();
  const grupACard = win.locator('.group-card', { hasText: 'Група А' });
  await expect(grupACard).toBeVisible();

  await grupACard.locator('button[title="видалити групу"]').click();
  await win.getByRole('button', { name: 'Видалити', exact: true }).click();

  // Група А видалена
  await expect(win.locator('.group-card', { hasText: 'Група А' })).toHaveCount(0);

  // Активність автоматично перейшла на «Групу 1»
  await expect(win.locator('.group-card .badge.done', { hasText: 'активна' })).toBeVisible();
});
