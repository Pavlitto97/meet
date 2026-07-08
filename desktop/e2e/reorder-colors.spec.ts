import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, closeApp, type LaunchedApp } from './helpers';

// Фічі: (1) колір буквеної аватарки — функція ІМЕНІ, стабільна на «початку»/«кінці»
// і при пересортуванні; (2) кольори в межах групи УНІКАЛЬНІ (дедуп: жодних двох
// учасників з однаковим кольором, ніхто не збігається з коричневим Sandro);
// (3) drag-and-drop сортування рядків таблиці (ручка drag_indicator у колонці №).
test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
test.beforeAll(async () => {
  launched = await launchApp();
});
test.afterAll(async () => {
  await closeApp(launched);
});

// Артефакти для ручної/MCP перевірки: повні рендери start/end після тесту кольорів.
const ARTIFACTS = path.join(__dirname, '.artifacts');

test('кольори буквених аватарок: від імені, однакові у start/end і після reorder', async () => {
  const win = launched.win;
  const probe = await win.evaluate(async () => {
    const j = (u: string) => fetch(u).then((r) => r.json());
    const groups = await j('/api/groups');
    const active = groups.find((g: any) => g.active).id;
    const ps = await j('/api/participants?group=' + active);
    const nonSandro = ps.filter((p: any) => !/devices\/316$/.test(p.device_id));
    // Імена з унікальними першими літерами (у шаблоні немає Я/Є) — щоб однозначно
    // знайти саме їхні кружечки у рендері.
    const a = nonSandro[0];
    const b = nonSandro[1];
    const put = (id: number, body: any) =>
      fetch('/api/participants/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    await put(a.id, { custom_name: 'Ящірка' });
    await put(b.id, { custom_name: 'Єнот' });

    // Всі буквені SVG рендеру: літера → список РІЗНИХ кольорів підложки.
    const colorsOf = async (which: string) => {
      const html = await (await fetch('/api/render?which=' + which)).text();
      const map: Record<string, string[]> = {};
      for (const m of html.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)) {
        let svg = '';
        try {
          svg = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
        } catch {
          continue;
        }
        const fill = /<rect[^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];
        const letter = /<text[^>]*>([^<]*)<\/text>/.exec(svg)?.[1];
        if (!fill || !letter) continue;
        const arr = (map[letter] ??= []);
        if (!arr.includes(fill)) arr.push(fill);
      }
      return map;
    };

    const start = await colorsOf('start');
    const end = await colorsOf('end');

    // Пересортування: Ящірку на самий верх → вона переїде в інший слот шаблону.
    const order = [a.id, ...ps.filter((p: any) => p.id !== a.id).map((p: any) => p.id)];
    await fetch('/api/participants/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: active, order }),
    });
    const afterReorder = await colorsOf('start');

    const startHtml = await (await fetch('/api/render?which=start')).text();
    const endHtml = await (await fetch('/api/render?which=end')).text();
    return { start, end, afterReorder, startHtml, endHtml };
  });

  // Ящірка: рівно один колір на ВСІ її появи (плитка/панель/кружечок/бейдж) …
  expect(probe.start['Я']).toHaveLength(1);
  // … той самий у «кінці» та після пересортування (колір іде за іменем, не за слотом).
  expect(probe.end['Я']).toEqual(probe.start['Я']);
  expect(probe.afterReorder['Я']).toEqual(probe.start['Я']);

  expect(probe.start['Є']).toHaveLength(1);
  expect(probe.end['Є']).toEqual(probe.start['Є']);
  expect(probe.afterReorder['Є']).toEqual(probe.start['Є']);

  // Sandro закріплений: завжди #8d6e63 (літера S).
  expect(probe.start['S']).toEqual(['#8d6e63']);
  expect(probe.end['S']).toEqual(['#8d6e63']);

  // Повні рендери — артефакти для візуальної перевірки (Playwright MCP/вручну).
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, 'render-start.html'), probe.startHtml);
  fs.writeFileSync(path.join(ARTIFACTS, 'render-end.html'), probe.endHtml);
});

test('drag-and-drop: перетягування рядка за ручку зберігає порядок', async () => {
  const win = launched.win;
  // Свіжий стан таблиці після reorder із попереднього тесту.
  await win.getByRole('button', { name: 'Оновити' }).click();

  const rows = win.locator('table.data tbody tr');
  await expect(rows).toHaveCount(11);

  const idsBefore = await win.evaluate(async () => {
    const groups = await (await fetch('/api/groups')).json();
    const active = groups.find((g: any) => g.active).id;
    const ps = await (await fetch('/api/participants?group=' + active)).json();
    return ps.map((p: any) => p.id) as number[];
  });

  // Тягнемо ТРЕТІЙ рядок за ручку на перший.
  await rows.nth(2).locator('.drag-handle').dragTo(rows.nth(0));

  await expect(win.locator('.toast')).toContainText('Порядок збережено');

  const idsAfter = await win.evaluate(async () => {
    const groups = await (await fetch('/api/groups')).json();
    const active = groups.find((g: any) => g.active).id;
    const ps = await (await fetch('/api/participants?group=' + active)).json();
    return ps.map((p: any) => p.id) as number[];
  });

  // Третій став першим, решта — без дірок у тому ж порядку.
  const expected = [idsBefore[2], ...idsBefore.filter((id) => id !== idsBefore[2])];
  expect(idsAfter).toEqual(expected);

  // І UI показує той самий порядок після перезавантаження списку.
  await win.getByRole('button', { name: 'Оновити' }).click();
  await expect(rows).toHaveCount(11);
});

test('дедуп кольорів: різні учасники — різні кольори, ніхто не збігається з Sandro', async () => {
  const win = launched.win;
  const probe = await win.evaluate(async () => {
    const j = (u: string) => fetch(u).then((r) => r.json());
    const groups = await j('/api/groups');
    const active = groups.find((g: any) => g.active).id;
    const ps = await j('/api/participants?group=' + active);
    const nonSandro = ps.filter((p: any) => !/devices\/316$/.test(p.device_id));
    // Кожному — ім'я з УНІКАЛЬНОЮ першою літерою (жодна ≠ S), щоб однозначно
    // зіставити кружечок ↔ учасник за літерою підложки.
    const pool = ['Аня', 'Богдан', 'Віктор', 'Гнат', 'Дарина', 'Емма', 'Захар', 'Ірина', 'Лада', 'Назар', 'Орест', 'Тарас'];
    const put = (id: number, body: any) =>
      fetch('/api/participants/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (let i = 0; i < nonSandro.length; i++) await put(nonSandro[i].id, { custom_name: pool[i] });

    // Літера підложки → набір РІЗНИХ кольорів (по всіх появах: плитка/панель/кружечок/бейдж).
    const byLetter: Record<string, string[]> = {};
    const html = await (await fetch('/api/render?which=start')).text();
    for (const m of html.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)) {
      let svg = '';
      try {
        svg = new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)));
      } catch {
        continue;
      }
      const fill = /<rect[^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];
      const letter = /<text[^>]*>([^<]*)<\/text>/.exec(svg)?.[1];
      if (!fill || !letter) continue;
      const arr = (byLetter[letter] ??= []);
      if (!arr.includes(fill)) arr.push(fill);
    }
    return { byLetter, letters: pool.slice(0, nonSandro.length).map((n) => [...n][0].toUpperCase()) };
  });

  // Кожен учасник (унікальна літера) → рівно один колір підложки.
  const colors: string[] = [];
  for (const L of probe.letters) {
    expect(probe.byLetter[L], `літера ${L}`).toHaveLength(1);
    colors.push(probe.byLetter[L][0]);
  }
  // Усі кольори учасників — унікальні (жодного дубля в межах групи — головний баг).
  expect(new Set(colors).size).toBe(colors.length);
  // Ніхто з решти не отримав коричневий Sandro; сам Sandro лишається коричневим.
  expect(colors).not.toContain('#8d6e63');
  expect(probe.byLetter['S']).toEqual(['#8d6e63']);
});
