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

// Файли-«плитки» учасника (img class m0DVAf/SOQwsf) — ЛИШЕ сюди підставляється
// фото. Решта ролей файлів — рядки панелі «Люди» (KjWwNd), кружечки «Ще 3 особи»
// (qg7mD) і бейдж People (Qw4c9e) — ЗАВЖДИ буквений кружечок (вимога: у списку
// «Люди» фото не показуються, навіть якщо є в системі).
let tileFiles: Set<string> | null = null;

function computeTileFiles(html: string): Set<string> {
  const out = new Set<string>();
  const re = /<img\b[^>]*?src="assets\/img\/people\/(u\w+)\.svg"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const cls = /class="([^"]*)"/.exec(m[0])?.[1] ?? '';
    if (cls.includes('m0DVAf') || cls.includes('SOQwsf')) out.add(m[1]);
  }
  return out;
}

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
    tileFiles = computeTileFiles(cachedMeetHtml);
  }
  let html = cachedMeetHtml;

  const rows = all(
    'SELECT device_id, original_name, custom_name, user_added, avatar, avatar_mime, avatar_end, avatar_end_mime ' +
      'FROM participants WHERE group_id = ? AND deleted = 0',
    [groupId]
  );

  // ─ аватарки/літери: підміна src буквених файлів учасника ─
  // Без фото — буквений кружечок: літера з АКТУАЛЬНОГО імені, колір — груповий
  // розклад (стабільний для групи ⇒ однаковий на «початку» і «кінці»).
  const letterColors = groupLetterColors(groupId);
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
    // Буквений кружечок — для панелі «Люди»/«Ще 3 особи»/бейджа ЗАВЖДИ
    // (фото там не показуємо), а для плитки — як фолбек без фото.
    const name =
      row.custom_name && String(row.custom_name).trim() !== ''
        ? String(row.custom_name)
        : latin1SpaceToUtf8(String(row.original_name));
    const letterUrl = letterAvatarDataUrl(name, letterColors[row.device_id] ?? assets.color);
    for (const f of assets.files) {
      const url = photoUrl !== null && tileFiles!.has(f) ? photoUrl : letterUrl;
      html = html.replaceAll(`assets/img/people/${f}.svg`, url);
    }
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
