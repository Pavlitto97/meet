/**
 * Генерація Meet HTML із правками (шаблон mqy-kiph-fci).
 *
 * Текстова заміна по сирому HTML БАЙТАМИ — НЕ DOM-парсинг. Працюємо у latin1-рядку
 * (1 символ = 1 байт), кирилиця лишається байт-у-байт (шаблон — чистий UTF-8).
 *
 * Аватарки: кожен <img> учасника в шаблоні посилається на УНІКАЛЬНИЙ файл
 * assets/img/people/uN.svg (буквена аватарка; згенеровано process-template.mjs).
 * Підміна йде глобальним replaceAll по імені файла — плитка (m0DVAf+SOQwsf),
 * рядок панелі «Люди» (KjWwNd), кружечки «Ще 3 особи» і бейдж People (Qw4c9e)
 * одного учасника оновлюються разом, без офсетної арифметики.
 */
import fs from 'node:fs';
import { all, toBuffer } from './db';
import { getSettings } from './settings';
import { meetHtmlPath } from './paths';
import {
  ORIGINAL_MEETING_CODE,
  ORIGINAL_TIME,
  PARTICIPANT_ASSETS,
  LETTER_COLORS,
  SANDRO_DEVICE,
  SANDRO_COLOR,
  utf8ToLatin1,
  emojiCodepoints,
} from './config';
import { parseCam, camIsServer, camHeadMarkup, degradeBlob } from './degrade';
import { activeGroupId, groupSlide } from './groups';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Буквена SVG-аватарка (та сама форма, що в scripts/process-template.mjs) як
 * data:-URI. Використовується, коли учасника перейменували, а фото не задали —
 * літера оновлюється, колір кружечка лишається рідним для плитки.
 */
function letterAvatarDataUrl(name: string, color: string): string {
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  const safe = letter.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">' +
    `<rect width="240" height="240" fill="${color}"/>` +
    `<text x="120" y="124" font-family="'App Sans','Roboto','Helvetica Neue',Arial,sans-serif"` +
    ` font-size="118" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${safe}</text>` +
    '</svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

// ─── Кольори кружечків по групі ────────────────────────────────────────────────
// Вимога: у межах групи кольори/місця ОДНАКОВІ на «початку» і «кінці» (скріни
// мають збігатись), але різні групи можуть мати різний розклад. Тому жодного
// Math.random — детермінований PRNG, сід = id групи.
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** device_id → колір кружечка для групи. Sandro закріплений (#8d6e63, «1 в 1»). */
function groupLetterColors(groupId: number): Record<string, string> {
  const palette = [...LETTER_COLORS];
  const rnd = mulberry32(groupId ^ 0x9e3779b9);
  for (let i = palette.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  const map: Record<string, string> = {};
  let k = 0;
  for (const device of Object.keys(PARTICIPANT_ASSETS)) {
    map[device] = device === SANDRO_DEVICE ? SANDRO_COLOR : palette[k++ % palette.length];
  }
  return map;
}

/** original_name у БД — latin1-простір (байти UTF-8); назад у читабельний рядок. */
const latin1SpaceToUtf8 = (s: string) => Buffer.from(s, 'latin1').toString('utf8');

// index.html read-only й рендером не мутується — читаємо з диска ОДИН раз
// (latin1) і переюзаємо. Кожен рендер працює на копіях через replace.
let cachedMeetHtml: string | null = null;

// Роль кожного буквеного файла uN.svg у шаблоні (за класом його <img>):
//  • tile   — плитка сітки (m0DVAf/SOQwsf): ЛИШЕ сюди підставляється фото;
//  • panel  — рядок панелі «Люди» (KjWwNd);
//  • circle — кружечок плитки «Ще N осіб» (qg7mD);
//  • badge  — мініатюра у бейджі People на тулбарі (Qw4c9e).
// panel/circle/badge — ЗАВЖДИ буквений кружечок (фото в списку «Люди» не показуємо).
// Карту юзаємо двічі: (1) фото лише у tile-файли; (2) приховати появи видаленого
// учасника, що НЕ покриті data-participant-id (circle/badge живуть поза плиткою/рядком).
type FileRole = 'tile' | 'panel' | 'circle' | 'badge';
let fileRoles: Record<string, FileRole> | null = null;
let tileFiles: Set<string> | null = null;

function computeFileRoles(html: string): Record<string, FileRole> {
  const out: Record<string, FileRole> = {};
  const re = /<img\b[^>]*?src="assets\/img\/people\/(u\w+)\.svg"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const cls = /class="([^"]*)"/.exec(m[0])?.[1] ?? '';
    let role: FileRole | null = null;
    if (cls.includes('m0DVAf') || cls.includes('SOQwsf')) role = 'tile';
    else if (cls.includes('qg7mD')) role = 'circle';
    else if (cls.includes('Qw4c9e')) role = 'badge';
    else if (cls.includes('KjWwNd')) role = 'panel';
    if (role) out[m[1]] = role;
  }
  return out;
}

// Українська форма слова «особа» за числом (для лейбла «Ще N осіб»).
function pluralOsoba(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'особа';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'особи';
  return 'осіб';
}

// Лейбл «Ще N осіб» у шаблоні (3 слоти-«інші» 302/306/307; рівно 1 входження).
const ORIGINAL_OTHERS_LABEL = 'Ще 3 особи';
const ORIGINAL_OTHERS_COUNT = 3;

export async function renderMeet(
  which = 'start',
  fit: string | null = null,
  cam: string | null = null,
  group: string | null = null
): Promise<Buffer> {
  if (which !== 'start' && which !== 'end') which = 'start';
  const { method: camMethod, intensity: camI } = parseCam(cam);
  // Учасники й імена — лише з однієї групи: явної (?group=) або активної.
  const groupId = group && Number.isFinite(parseInt(group, 10)) ? parseInt(group, 10) : activeGroupId();

  if (cachedMeetHtml === null) {
    cachedMeetHtml = fs.readFileSync(meetHtmlPath()).toString('latin1');
    fileRoles = computeFileRoles(cachedMeetHtml);
    tileFiles = new Set(Object.keys(fileRoles).filter((f) => fileRoles![f] === 'tile'));
  }
  let html = cachedMeetHtml;

  const rows = all(
    'SELECT device_id, original_name, custom_name, user_added, avatar, avatar_mime, avatar_end, avatar_end_mime ' +
      'FROM participants WHERE group_id = ? AND deleted = 0 ORDER BY position',
    [groupId]
  );

  // Видалені (м'яко) слоти шаблону: їхні плитка/рядок панелі «Люди»/кружечок
  // лишаються в сирому HTML із рідним іменем+аватаркою, бо replace нижче бере
  // лише активні rows. Щоб видалений учасник зник зі скріна — приховуємо всі
  // його появи CSS-ом (нижче, через headInject). user_added (local/*) у шаблоні
  // не існують, тож фільтруємо лише слоти з asset-файлами.
  const deletedDevices = all(
    'SELECT device_id FROM participants WHERE group_id = ? AND deleted != 0',
    [groupId]
  )
    .map((r) => String(r.device_id))
    .filter((d) => PARTICIPANT_ASSETS[d]);

  // «Інші» — слоти плитки «Ще N осіб»: шаблонні слоти БЕЗ власної плитки сітки
  // (жоден їхній файл не має ролі tile → 302/306/307). Визначаємо за ШАБЛОНОМ, а
  // НЕ за БД-прапором skipped (у міграованих/правлених групах він = 0). otherRows —
  // активні «інші» у порядку показу; circleSlots — фізичні кружечки-прев'ю (рівно 2).
  const isOtherDevice = (device: string): boolean => {
    const a = PARTICIPANT_ASSETS[device];
    return !!a && a.files.every((f) => fileRoles![f] !== 'tile');
  };
  const otherRows = rows.filter((r) => isOtherDevice(r.device_id));
  const circleSlots = Object.keys(fileRoles!).filter((f) => fileRoles![f] === 'circle');

  // ─ аватарки/літери: підміна src буквених файлів учасника ─
  // Без фото — буквений кружечок: літера з АКТУАЛЬНОГО імені, колір — груповий
  // розклад (стабільний для групи ⇒ однаковий на «початку» і «кінці»).
  const letterColors = groupLetterColors(groupId);
  const letterFor = (row: any): string => {
    const nm =
      row.custom_name && String(row.custom_name).trim() !== ''
        ? String(row.custom_name)
        : latin1SpaceToUtf8(String(row.original_name));
    return letterAvatarDataUrl(nm, letterColors[row.device_id] ?? PARTICIPANT_ASSETS[row.device_id].color);
  };
  for (const row of rows) {
    const assets = PARTICIPANT_ASSETS[row.device_id];
    if (!assets) continue; // user_added (local/*) не мають плитки у шаблоні

    let blob: Buffer | null;
    let mime: string | null;
    // 'end' лише якщо avatar_end існує І непорожній — інакше фолбек на start (як було).
    const endBuf = which === 'end' ? toBuffer(row.avatar_end) : null;
    if (endBuf && endBuf.length > 0) {
      blob = endBuf;
      mime = row.avatar_end_mime;
    } else {
      blob = toBuffer(row.avatar);
      mime = row.avatar_mime;
    }

    // Фото (якщо є) — лише для плитки.
    let photoUrl: string | null = null;
    if (blob && blob.length > 0 && mime) {
      // Серверні методи (gd/gd-jpeg) бейкають деградацію прямо в байти аватарки.
      if (camI > 0 && camIsServer(camMethod)) {
        [blob, mime] = await degradeBlob(blob, mime, camMethod, camI);
      }
      photoUrl = 'data:' + mime + ';base64,' + blob.toString('base64');
    }
    // Буквений кружечок — для панелі «Люди»/бейджа ЗАВЖДИ (фото там не показуємо),
    // а для плитки — як фолбек без фото. Кружечки «Ще N осіб» (qg7mD) — окремий
    // прохід нижче: слот може перейти до іншого «іншого» при видаленні власника.
    const letterUrl = letterFor(row);
    for (const f of assets.files) {
      if (fileRoles![f] === 'circle') continue;
      const url = photoUrl !== null && tileFiles!.has(f) ? photoUrl : letterUrl;
      html = html.replaceAll(`assets/img/people/${f}.svg`, url);
    }
  }

  // ─ кружечки-прев'ю плитки «Ще N осіб» ─
  // У шаблоні рівно 2 фізичні слоти (u20,u21). НЕ прив'язуємо слот до «власника»
  // (302→u20, 306→u21) — інакше після видалення власника лишився б 1 кружечок при
  // «Ще 2 особи». Показуємо ПЕРШИХ N активних «інших»; слот переходить до наступного.
  for (let i = 0; i < circleSlots.length && i < otherRows.length; i++) {
    html = html.replaceAll(`assets/img/people/${circleSlots[i]}.svg`, letterFor(otherRows[i]));
  }

  // ─ імена: глобальна заміна (плитка + шапка + панель «Люди») ─
  // user_added (local/*) поза грою: їхній original_name — довільний текст
  // користувача, глобальний replaceAll по ньому міг би зачепити текст шаблону.
  const namePairs = rows.filter((r) => !r.user_added && r.custom_name !== null && r.custom_name !== '');
  // Довші оригінали — перші (щоб короткі підрядки не псували довші).
  namePairs.sort((a, b) => b.original_name.length - a.original_name.length);
  for (const r of namePairs) {
    const repl = utf8ToLatin1(String(r.custom_name));
    if (repl !== r.original_name) {
      // () => repl: замінник — літерал ($-патерни в імені не інтерпретуються).
      html = html.replaceAll(r.original_name, () => repl);
    }
  }

  // ─ лічильник учасників у бейджі «Люди» (toolbar) ─
  // Шаблон статично показує "12" = 11 дефолтних учасників + 1 «(Ви)»: Sandro
  // дублюється у панелі «Люди» як локальний користувач, тож загальний headcount
  // на одиницю більший за кількість керованих плиток. Список панелі — статичний
  // HTML (рендер його не перебудовує), синхронізуємо лише число у бейджі, щоб
  // воно змінювалось разом із кількістю учасників групи (додавання/видалення).
  const headcount = rows.length + 1;
  html = html.replace(
    /(<div class="fs3avc">)\d+(<\/div>)/,
    (_m, a, b) => a + headcount + b
  );
  // Те саме число — у заголовку «Співавтори N» панелі «Люди» (MKVSQd): панель
  // показує Sandro двічі (як «Ви» і як презентера), тож rows.length + 1 = к-сть
  // рядків панелі. Синхронізуємо, щоб лічильник падав разом із видаленням.
  html = html.replace(
    /(<div class="MKVSQd">)\d+(<\/div>)/,
    (_m, a, b) => a + headcount + b
  );

  // ─ приховування видалених учасників + лейбл «Ще N осіб» ─
  // Видалену появу ХОВАЄМО CSS-ом (нижче, у headInject), а не вирізаємо з HTML:
  //  • плитка сітки і рядок панелі «Люди» мають data-participant-id;
  //  • бейдж People (Qw4c9e) — поза плиткою/рядком, тож ловимо за УНІКАЛЬНИМ src
  //    буквеного файла (для видалених src лишається недоторканим — replace вище
  //    проходить лише по активних rows).
  // (Кружечки «Ще N осіб» не ховаємо тут — їх переназначено активним «іншим» вище.)
  // :has() підтримується Chromium скріна (вже юзається у raster-стилях нижче).
  const hideSelectors: string[] = [];
  for (const device of deletedDevices) {
    const idSel = `[data-participant-id="${device}"]`;
    hideSelectors.push(`.dkjMxf:has(> ${idSel})`); // плитка сітки (позиційна обгортка)
    hideSelectors.push(`[role="listitem"]${idSel}`); // рядок панелі «Люди»
    // Бейдж People (Qw4c9e) — поза плиткою/рядком, ловимо за унікальним src.
    // Кружечки «Ще N осіб» тут НЕ чіпаємо: вони переназначаються активним «іншим»
    // (вище), а зайві слоти ховаються нижче за лічильником.
    for (const f of PARTICIPANT_ASSETS[device].files) {
      if (fileRoles![f] === 'badge') {
        hideSelectors.push(`.G9bi9d:has(> img[src="assets/img/people/${f}.svg"])`);
      }
    }
  }

  // «Ще N осіб»: N = к-сть активних «інших» (otherRows). 0 → ховаємо всю плитку;
  // інакше правимо число+форму й ховаємо ЗАЙВІ кружечки-слоти (понад N — їх НЕ
  // переназначено вище, тож вони лишились із недоторканим template-src).
  const remainingOthers = otherRows.length;
  if (remainingOthers <= 0) {
    hideSelectors.push('.dkjMxf:has(img.qg7mD)'); // плитка «Ще N осіб» — цілком
  } else {
    for (let i = remainingOthers; i < circleSlots.length; i++) {
      hideSelectors.push(`.gdIo3e:has(> img[src="assets/img/people/${circleSlots[i]}.svg"])`);
    }
    if (remainingOthers !== ORIGINAL_OTHERS_COUNT) {
      const repl = `Ще ${remainingOthers} ${pluralOsoba(remainingOthers)}`;
      html = html.replaceAll(utf8ToLatin1(ORIGINAL_OTHERS_LABEL), () => utf8ToLatin1(repl));
    }
  }

  // ─ глобальні налаштування (код зустрічі, час 24h) ─
  const s = getSettings(false);
  const newCode = String((s.meeting_code ?? '') !== '' ? s.meeting_code : ORIGINAL_MEETING_CODE).trim();
  if (newCode !== '' && newCode !== ORIGINAL_MEETING_CODE) {
    html = html.replaceAll(ORIGINAL_MEETING_CODE, () => utf8ToLatin1(newCode));
  }

  // Час у шапці — 24-годинний (як в Україні), без AM/PM: рівно один
  // <span jsname="W5i7Bf">13:41</span>; AM/PM-спан (d1rraf) у шаблоні порожній.
  const timeKey = which === 'end' ? 'end_time' : 'start_time';
  const newTime = String((s[timeKey] ?? '') !== '' ? s[timeKey] : ORIGINAL_TIME).trim();
  if (newTime !== '' && newTime !== ORIGINAL_TIME) {
    html = html.replace(
      new RegExp(`(<span jsname="W5i7Bf">)${escapeRe(ORIGINAL_TIME)}(</span>)`),
      (_m, a, b) => a + newTime + b
    );
  }

  // ─ слайд презентації групи: <video data-uid="100"> → <img> зі слайдом ─
  // Розмір/положення успадковуються від відео-області шаблону; зображення
  // вписується contain на чорному тлі — як справжня презентація у Meet.
  const slide = groupSlide(groupId);
  if (slide) {
    const slideUrl = 'data:' + slide[1] + ';base64,' + slide[0].toString('base64');
    html = html.replace(/<video\b([^>]*?data-uid="100"[^>]*?)><\/video>/, (_m, attrs: string) => {
      const style = /style="([^"]*)"/.exec(attrs)?.[1] ?? '';
      const w = /width:\s*([\d.]+px)/.exec(style)?.[1] ?? '100%';
      const h = /height:\s*([\d.]+px)/.exec(style)?.[1] ?? '100%';
      return (
        `<img class="Gv1mTb-aTv5jf" alt="" src="${slideUrl}" ` +
        `style="width: ${w}; height: ${h}; object-fit: contain; background: #000; display: block;">`
      );
    });
  }

  // ─ emoji-кнопки реакцій (як у старому шаблоні; у цьому збереженні їх немає — no-op) ─
  const emojiMap = emojiCodepoints();
  html = html.replace(
    /(<img\b[^>]*?\bdata-emoji="([^"]+)"[^>]*?\s)src="[^"]*"([^>]*?>)/g,
    (full, pre, emoji, post) => {
      const code = emojiMap[emoji];
      if (!code) return full;
      return pre + 'src="assets/img/emoji/' + code + '.png"' + post;
    }
  );

  // Натуральний розмір сцени — з inline-стилю #yDmH0d (збережена сторінка).
  let natW = 2560;
  let natH = 1271;
  const nm = /id="yDmH0d"[^>]*style="[^"]*\bwidth:\s*(\d+)px;\s*height:\s*(\d+)px/.exec(html);
  if (nm) {
    natW = parseInt(nm[1], 10);
    natH = parseInt(nm[2], 10);
  }

  // <base href="/"> + override-стилі: РАСТРОВЕ data:-фото (jpeg/png/webp) розтягуємо
  // на всю плитку; SVG-літери (data:image/svg+xml) лишаються рідними кружечками.
  //
  // Геометрія сцени: у збереженій сторінці c-wiz має width:100vw + overflow:hidden,
  // тож у вікні, вужчому за natW, плитки учасників (x≥1604) КЛІПАЛИСЬ (чорна зона
  // на скрінах). Пінимо c-wiz до натуральних розмірів і вмикаємо transform на
  // #yDmH0d — він стає containing block для fixed-елементів (шапка, панель «Люди»,
  // контролбар), і вся сторінка поводиться як полотно natW×natH незалежно від
  // вікна. Скрін-режим ?fit= нижче лише міняє масштаб цього transform.
  const raster = 'img.m0DVAf[src^="data:image/"]:not([src^="data:image/svg"])';
  let headInject =
    '<base href="/">' +
    '<style>' +
    `#yDmH0d{transform:scale(1);transform-origin:top left;}` +
    `c-wiz.SSPGKf{width:${natW}px!important;height:${natH}px!important;}` +
    `.FKJK2b:has(${raster}){position:relative!important;}` +
    `.FKJK2b ${raster}{` +
    'position:absolute!important;inset:0!important;' +
    'width:100%!important;height:100%!important;' +
    'object-fit:cover!important;border-radius:inherit!important;' +
    'display:block!important;clip-path:none!important;z-index:5!important;}' +
    `.FKJK2b:has(${raster}) img.SOQwsf{display:none!important;}` +
    // Кружечки панелі «Люди»/«Ще 3 особи» (KjWwNd; height:100%, width — за аспектом
    // картинки) і бейджа People (Qw4c9e): фото-аватарка не квадратна (на відміну
    // від SVG-літер з viewBox 1:1) — без цього бокс розтягується в овал.
    'img.KjWwNd[src^="data:image/"]:not([src^="data:image/svg"]),' +
    'img.Qw4c9e[src^="data:image/"]:not([src^="data:image/svg"])' +
    '{aspect-ratio:1/1!important;object-fit:cover!important;}' +
    '</style>';

  // Приховати всі появи видалених учасників (плитка/рядок/кружечок/бейдж).
  if (hideSelectors.length) {
    headInject += '<style>' + hideSelectors.join(',') + '{display:none!important;}</style>';
  }

  // Браузерні методи деградації (css): фільтр накладе сам браузер при рендері.
  headInject += camHeadMarkup(camMethod, camI);

  // Скрін-режим ?fit=ШИРИНАxВИСОТА — масштабувати #yDmH0d під вікно (без білих полос).
  const fm = fit ? /^(\d+)x(\d+)$/.exec(fit) : null;
  if (fm) {
    const fitW = parseInt(fm[1], 10);
    const fitH = parseInt(fm[2], 10);
    if (fitW > 0 && fitH > 0 && natW > 0 && natH > 0) {
      const sx = (fitW / natW).toFixed(6);
      const sy = (fitH / natH).toFixed(6);
      headInject +=
        '<style>' +
        'html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important;}' +
        `#yDmH0d{transform:scale(${sx},${sy})!important;transform-origin:top left!important;}` +
        '</style>';
    }
  }

  const needle = '<head>';
  const idx = html.indexOf(needle);
  if (idx !== -1) {
    html = html.slice(0, idx) + needle + headInject + html.slice(idx + needle.length);
  }

  return Buffer.from(html, 'latin1');
}
