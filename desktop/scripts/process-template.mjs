/**
 * Обробка сирої збереженої сторінки Meet «mqy-kiph-fci» у шаблон рендера:
 *
 *   node scripts/process-template.mjs [шлях-до-сирого-html]
 *
 * 1. Генерує буквені SVG-аватарки (renderer/public/assets/img/people/uN.svg) —
 *    збережена сторінка посилається на відсутню теку `Meet_ _mqy-kiph-fci__files/`,
 *    кольори/літери зняті зі скріншота користувача (канонічна палітра Google).
 * 2. Докачує відсутні шрифти/іконки gstatic у renderer/public/assets/ (ідемпотентно).
 * 3. Чистить HTML (скрипти, обробники, preconnect, <base>), переписує CDN-URL на
 *    локальні assets/, мапить битий `_files/unnamed(N).png` → assets/img/people/uN.svg,
 *    далі Google→App / google→app (байт-у-байт, latin1-простір).
 * 4. Пише desktop/resources/index.html і .bak; самоперевірки наприкінці.
 *
 * Запускається вручну при заміні шаблону. Мережа потрібна лише для першого запуску
 * (шрифти кешуються у public/assets/fonts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(DESKTOP, '..');
const SRC = process.argv[2] ?? path.join(REPO, 'Meet_ _mqy-kiph-fci_.html');
const PUB = path.join(DESKTOP, 'renderer', 'public');
const PEOPLE_DIR = path.join(PUB, 'assets', 'img', 'people');
const FONTS_DIR = path.join(PUB, 'assets', 'fonts');
const IMG_DIR = path.join(PUB, 'assets', 'img');
const OUT = path.join(DESKTOP, 'resources', 'index.html');
const OUT_BAK = path.join(DESKTOP, 'resources', 'index.html.bak');

// ─── 1. Буквені аватарки ──────────────────────────────────────────────────────
// Кольори зняті зі скріншота image_2026-06-12_13-40-37.png (= палітра Material).
// Файл uN відповідає `unnamed(N).png` збереженої сторінки. Плитка (m0DVAf+SOQwsf),
// рядок панелі «Люди» (KjWwNd), кружечки «Ще 3 особи» (qg7mD) і бейдж People (Qw4c9e)
// одного учасника — ТОЙ САМИЙ аватар у різних розмірах.
const PEOPLE = [
  { name: 'Sandro Machaidze', letter: 'S', color: '#8d6e63', files: [4, 5, 22, 0] },
  { name: 'Анатолій', letter: 'А', color: '#00897b', files: [6, 7, 23, 2] },
  { name: 'Валерій', letter: 'В', color: '#33691e', files: [8, 9, 25, 3] },
  { name: 'Олександр', letter: 'О', color: '#7e57c2', files: [10, 11, 30, 1] },
  { name: 'Михайло', letter: 'М', color: '#33691e', files: [12, 13, 29] },
  { name: 'Андрій', letter: 'А', color: '#c2185b', files: [14, 15, 24] },
  { name: 'Федір', letter: 'Ф', color: '#01579b', files: [16, 17, 31] },
  { name: 'Юрій', letter: 'Ю', color: '#689f38', files: [18, 19, 32] },
  { name: 'Кирило', letter: 'К', color: '#8d6e63', files: [20, 27] },
  { name: 'Денис', letter: 'Д', color: '#00897b', files: [21, 26] },
  { name: 'Максим', letter: 'М', color: '#455a64', files: [28] },
];

export function letterAvatarSvg(letter, color) {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">' +
    `<rect width="240" height="240" fill="${color}"/>` +
    `<text x="120" y="124" font-family="'App Sans','Roboto','Helvetica Neue',Arial,sans-serif"` +
    ` font-size="118" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${letter}</text>` +
    '</svg>'
  );
}

function generateAvatars() {
  fs.mkdirSync(PEOPLE_DIR, { recursive: true });
  let n = 0;
  for (const p of PEOPLE) {
    for (const f of p.files) {
      fs.writeFileSync(path.join(PEOPLE_DIR, `u${f}.svg`), letterAvatarSvg(p.letter, p.color));
      n++;
    }
  }
  // копії пари Sandro для презентаційної плитки (не підміняються рендером)
  const sandro = PEOPLE[0];
  for (const f of ['u4p', 'u5p']) {
    fs.writeFileSync(path.join(PEOPLE_DIR, `${f}.svg`), letterAvatarSvg(sandro.letter, sandro.color));
    n += 1;
  }
  console.log(`SVG-аватарок записано: ${n} → ${path.relative(DESKTOP, PEOPLE_DIR)}`);
}

// ─── 2. Завантаження відсутніх ресурсів ───────────────────────────────────────
async function download(url, dest) {
  if (fs.existsSync(dest)) return false;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return true;
    } catch (e) {
      if (attempt >= 3) throw new Error(`не скачалось ${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

// Іменовані іконки (хеш у назві прибираємо; 'google' у назві файла не лишаємо —
// глобальний rename google→app інакше зламає посилання).
const ICON_MAP = [
  [/https?:\/\/fonts\.gstatic\.com\/s\/i\/short-term\/release\/googlesymbols\/more_horiz\/default\/24px\.svg/g, 'assets/img/more_horiz_24px.svg'],
  [/https?:\/\/fonts\.gstatic\.com\/s\/i\/short-term\/release\/googlesymbols\/remove\/default\/24px\.svg/g, 'assets/img/remove_24px.svg'],
  [/https?:\/\/www\.gstatic\.com\/meet\/icons\/logo_meet_2026_white_text_google_meet_dark_web_[a-f0-9]+\.svg/g, 'assets/img/meet_text_logo_dark.svg'],
  [/https?:\/\/www\.gstatic\.com\/meet\/icons\/logo_meet_2026_text_google_meet_light_web_[a-f0-9]+\.svg/g, 'assets/img/meet_text_logo_light.svg'],
  [/https?:\/\/www\.gstatic\.com\/meet\/google_meet_primary_horizontal_2020q4_white_[a-f0-9]+\.svg/g, 'assets/img/meet_horizontal_white.svg'],
  [/https?:\/\/www\.gstatic\.com\/meet\/google_meet_primary_horizontal_2020q4_logo_[a-f0-9]+\.svg/g, 'assets/img/meet_horizontal_logo.svg'],
  [/https?:\/\/www\.gstatic\.com\/meet\/meetinpip_darkmode_icon_[a-f0-9]+\.svg/g, 'assets/img/meetinpip_darkmode_icon.svg'],
  [/https?:\/\/www\.gstatic\.com\/meet\/no_one_is_sharing_[a-f0-9]+\.svg/g, 'assets/img/no_one_is_sharing.svg'],
  [/https?:\/\/www\.gstatic\.com\/meet\/pip_on_present_v2_[a-f0-9]+\.svg/g, 'assets/img/pip_on_present_v2.svg'],
  [/(?:https?:)?\/\/ssl\.gstatic\.com\/docs\/documents\/share\/images\/sprite-24\.svg/g, 'assets/img/sprite-24.svg'],
  [/(?:https?:)?\/\/ssl\.gstatic\.com\/docs\/documents\/share\/images\/spinner-2\.gif/g, 'assets/img/spinner-2.gif'],
  [/(?:https?:)?\/\/ssl\.gstatic\.com\/ui\/v1\/dialog\/close-x\.png/g, 'assets/img/close-x.png'],
  [/(?:https?:)?\/\/ssl\.gstatic\.com\/i18n\/flags\/48x32\/nobevel\/[a-f0-9]+\/flags\.png/g, 'assets/img/flags/flags.png'],
  [/https?:\/\/www\.gstatic\.com\/images\/branding\/productlogos\/meet_2026\/v2\/web-(\d+)dp\/logo_meet_2026_color_1x_web_\1dp\.png/g,
    (m, dp) => `assets/img/meet_logo/logo_meet_2026_color_1x_web_${dp}dp.png`],
  // реальна аватарка акаунта (lh3) → плейсхолдер
  [/https?:\/\/lh3\.googleusercontent\.com\/a\/[A-Za-z0-9_\-=\\u003d]+/g, 'assets/img/placeholder.svg'],
];

async function downloadMissing(html) {
  // шрифти: всі fonts.gstatic.com/s/... → assets/fonts/<basename>
  const fontUrls = [...new Set(html.match(/https?:\/\/fonts\.gstatic\.com\/s\/[A-Za-z0-9_/.-]+?\.woff2?/g) ?? [])];
  let dl = 0;
  for (const u of fontUrls) {
    if (await download(u, path.join(FONTS_DIR, path.basename(u)))) dl++;
  }
  console.log(`шрифтів у шаблоні: ${fontUrls.length}, докачано: ${dl}`);

  // іконки, що мапляться на локальні файли і яких ще немає
  const iconDl = [
    ['https://ssl.gstatic.com/docs/documents/share/images/spinner-2.gif', path.join(IMG_DIR, 'spinner-2.gif')],
    ['https://ssl.gstatic.com/ui/v1/dialog/close-x.png', path.join(IMG_DIR, 'close-x.png')],
    ['https://www.gstatic.com/meet/icons/logo_meet_2026_white_text_google_meet_dark_web_3cc602b79497ffa3010541c62a6318f4.svg', path.join(IMG_DIR, 'meet_text_logo_dark.svg')],
    ['https://www.gstatic.com/meet/icons/logo_meet_2026_text_google_meet_light_web_37782129bbf9be1a8e56e6fbec4fef50.svg', path.join(IMG_DIR, 'meet_text_logo_light.svg')],
    ['https://www.gstatic.com/meet/google_meet_primary_horizontal_2020q4_white_d1d4e45059e8500b3e4df43878d865fc.svg', path.join(IMG_DIR, 'meet_horizontal_white.svg')],
    ['https://www.gstatic.com/meet/google_meet_primary_horizontal_2020q4_logo_be3f8c43950bd1e313525ada2ce0df44.svg', path.join(IMG_DIR, 'meet_horizontal_logo.svg')],
  ];
  for (const [u, dest] of iconDl) {
    if (await download(u, dest)) console.log('  скачано:', path.basename(dest));
  }
}

// ─── 3. Трансформація HTML ────────────────────────────────────────────────────
function transform(html) {
  const stat = (label, before, after) => console.log(`  ${label}: ${before - after >= 0 ? '' : '+'}${Math.abs(before - after)}`);
  const count = (re) => (html.match(re) ?? []).length;

  // скрипти/noscript
  let c = count(/<script\b/gi);
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '');
  console.log(`  <script> прибрано: ${c}`);
  html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '');

  // inline-обробники
  c = count(/\son[a-z]+\s*=\s*"/gi);
  html = html.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '').replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');
  console.log(`  on*-обробників прибрано: ${c}`);

  // preconnect/dns-prefetch на google-домени + <base>
  html = html.replace(/<link\b[^>]*\brel\s*=\s*"(?:preconnect|dns-prefetch)"[^>]*>/gi, '');
  c = count(/<base\b/gi);
  html = html.replace(/<base\b[^>]*>/gi, '');
  console.log(`  <base> прибрано: ${c} (рендер вживляє власний <base href="/">)`);

  // шрифти → локальні
  html = html.replace(/https?:\/\/fonts\.gstatic\.com\/s\/[A-Za-z0-9_/.-]+?\.woff2?/g, (m) => 'assets/fonts/' + m.split('/').pop());

  // іконки → локальні
  for (const [re, repl] of ICON_MAP) {
    html = html.replace(re, repl);
  }

  // битий локальний кеш збереженої сторінки → наші буквені аватарки
  c = count(/\.\/Meet_ _mqy-kiph-fci__files\//g);
  html = html.replace(/\.\/Meet_ _mqy-kiph-fci__files\/unnamed\((\d+)\)\.png/g, 'assets/img/people/u$1.svg');
  html = html.replace(/\.\/Meet_ _mqy-kiph-fci__files\/unnamed\.png/g, 'assets/img/people/u0.svg');
  // службові iframe-сторінки збереження (proxy/saved_resource) → інертні
  html = html.replace(/\.\/Meet_ _mqy-kiph-fci__files\/[A-Za-z0-9_.-]+\.html/g, 'about:blank');
  console.log(`  _files-посилань переписано: ${c}`);

  // Презентаційна плитка (devices/320) містить КОПІЮ аватарної пари Sandro
  // (u4/u5). Рендер підміняє src глобально по імені файла — щоб фото Sandro не
  // затулило слайд, копії в межах презентаційної плитки перейменовуємо на
  // u4p/u5p (на них ніхто не мапиться).
  const presStart = html.indexOf('data-participant-id="spaces/A6_qfu4mFcwB/devices/320"');
  const presEnd = html.indexOf('data-participant-id="spaces/A6_qfu4mFcwB/devices/295"');
  if (presStart === -1 || presEnd === -1 || presEnd < presStart) {
    throw new Error('не знайшов межі презентаційної плитки (320→295)');
  }
  const pres = html
    .slice(presStart, presEnd)
    .replace('assets/img/people/u4.svg', 'assets/img/people/u4p.svg')
    .replace('assets/img/people/u5.svg', 'assets/img/people/u5p.svg');
  html = html.slice(0, presStart) + pres + html.slice(presEnd);
  console.log('  презентаційна плитка: u4/u5 → u4p/u5p');

  // Google → App (після всіх URL-переписувань)
  c = count(/Google/g);
  html = html.replace(/Google/g, 'App');
  const c2 = count(/google/g);
  html = html.replace(/google/g, 'app');
  console.log(`  Google→App: ${c}, google→app: ${c2}`);

  return html;
}

function assertAll(html) {
  const checks = [
    [/<script\b/i, false, 'лишився <script>'],
    [/<base\b/i, false, 'лишився <base>'],
    [/Meet_ _mqy-kiph-fci__files/, false, 'лишились биті _files-посилання'],
    [/fonts\.gstatic\.com/, false, 'лишились gstatic-шрифти'],
    [/data-participant-id="/g, 21, 'кількість data-participant-id'],
    [/<span jsname="W5i7Bf">13:41<\/span>/, true, 'час 13:41 у шапці'],
    [/mqy-kiph-fci/g, true, 'код зустрічі'],
    [/<video\b[^>]*data-uid="100"/, true, 'відео-область презентації'],
    [/assets\/img\/people\/u4\.svg/, true, 'аватарка Sandro (u4)'],
  ];
  for (const [re, expected, label] of checks) {
    const m = html.match(re);
    const n = m ? (re.global ? m.length : 1) : 0;
    const ok = typeof expected === 'number' ? n === expected : expected ? n > 0 : n === 0;
    console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label}${typeof expected === 'number' ? ` (${n}/${expected})` : ''}`);
    if (!ok) process.exitCode = 1;
  }
  // зовнішні ресурси, що реально фетчаться (src/href/url) — має бути нуль
  // meet.app.com — інертні посилання-копії meeting-лінка (нікуди не фетчаться)
  const left = [...new Set((html.match(/(?:src|href)="https?:\/\/[^"]+"|url\(https?:\/\/[^)]+\)/g) ?? []))].filter(
    (l) => !l.includes('meet.app.com')
  );
  if (left.length) {
    console.log(`  УВАГА: лишилось ${left.length} зовнішніх src/href/url():`);
    for (const l of left.slice(0, 10)) console.log('   ', l.slice(0, 120));
  } else {
    console.log('  OK  зовнішніх src/href/url() не лишилось');
  }
}

const raw = fs.readFileSync(SRC);
console.log(`Сирий шаблон: ${SRC} (${raw.length} байт)`);
let html = raw.toString('latin1'); // 1 символ = 1 байт

generateAvatars();
await downloadMissing(html);
console.log('Трансформація:');
html = transform(html);
console.log('Самоперевірки:');
assertAll(html);

const out = Buffer.from(html, 'latin1');
fs.writeFileSync(OUT, out);
fs.writeFileSync(OUT_BAK, out);
console.log(`Записано: ${path.relative(DESKTOP, OUT)} і .bak (${out.length} байт)`);
