/**
 * Константи та дефолтні дані проєкту (порт meeteditor/config.php).
 * Без залежностей від решти пакета і БЕЗ electron — лише значення й чисті функції.
 */

// ─── mojibake-перетворення ────────────────────────────────────────────────────
// Кожен байт UTF-8-літерала трактуємо як Latin-1 codepoint і кодуємо назад у UTF-8.
// Саме так зіпсувались кирилічні імена у збереженій сторінці Meet. Будуємо
// дефолтні original_name тим самим перетворенням — щоб збігалось БАЙТ-У-БАЙТ.
//
// Повертаємо РЯДОК у latin1-просторі (1 символ = 1 байт): саме так render.ts
// тримає весь HTML, тож офсети й заміни збігаються з байтовою семантикою PHP.
function mojibakeBytes(src: Buffer): string {
  const out: number[] = [];
  for (const b of src) {
    if (b < 0x80) out.push(b);
    else out.push(0xc0 | (b >> 6), 0x80 | (b & 0x3f));
  }
  return Buffer.from(out).toString('latin1');
}

/** latin1_to_utf8($s) для звичайного UTF-8-рядка. */
export function latin1ToUtf8(s: string): string {
  return mojibakeBytes(Buffer.from(s, 'utf8'));
}

/**
 * UTF-8-рядок → latin1-простір (1 символ = 1 байт), БЕЗ mojibake-подвоєння.
 * Шаблон mqy-kiph-fci збережено з чистим UTF-8 (на відміну від старого), тож
 * pre-image імені у байтах HTML — це просто його UTF-8-байти.
 */
export function utf8ToLatin1(s: string): string {
  return Buffer.from(s, 'utf8').toString('latin1');
}

// ─── OpenRouter ─────────────────────────────────────────────────────────────────
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
export const DEFAULT_GEN_MODEL = 'google/gemini-2.5-flash-image';
export const DEFAULT_GEN_PROVIDER = 'google-ai-studio';
export const DEFAULT_GEN_TIER = 'flex';

// ─── Початкові значення у HTML (що саме шукати для заміни) ─────────────────────────
// Шаблон — збережена сторінка Meet «mqy-kiph-fci» (українська локаль, 24-год час,
// Sandro показує презентацію, відкрита панель «Люди»). Див. scripts/process-template.mjs.
export const ORIGINAL_MEETING_CODE = 'mqy-kiph-fci';
export const ORIGINAL_TIME = '13:41';

/** Простір девайсів шаблону mqy-kiph-fci. */
export const TEMPLATE_SPACE = 'spaces/A6_qfu4mFcwB';
/** Простір девайсів СТАРОГО шаблону (yrt-kczi-csw) — для міграції БД. */
export const LEGACY_SPACE = 'spaces/mBsECBRYcS4B';

/**
 * Міграція БД зі старого шаблону: редаговані плитки переносяться на нові слоти
 * за порядком (кастомні імена/фото/генерації зберігаються). Слоти без пари
 * (Pavlo/«3 others») видаляються — нові skipped-слоти сідяться з дефолтів.
 */
export const LEGACY_DEVICE_MAP: Record<string, string> = {
  [`${LEGACY_SPACE}/devices/127`]: `${TEMPLATE_SPACE}/devices/316`, // Sandro
  [`${LEGACY_SPACE}/devices/129`]: `${TEMPLATE_SPACE}/devices/295`,
  [`${LEGACY_SPACE}/devices/131`]: `${TEMPLATE_SPACE}/devices/296`,
  [`${LEGACY_SPACE}/devices/132`]: `${TEMPLATE_SPACE}/devices/297`,
  [`${LEGACY_SPACE}/devices/133`]: `${TEMPLATE_SPACE}/devices/298`,
  [`${LEGACY_SPACE}/devices/134`]: `${TEMPLATE_SPACE}/devices/299`,
  [`${LEGACY_SPACE}/devices/135`]: `${TEMPLATE_SPACE}/devices/300`,
};

export interface DefaultParticipant {
  device_id: string;
  original_name: string; // latin1-байтовий рядок (= UTF-8-байти імені у HTML)
  custom_name: string | null;
  skipped: boolean;
}

/**
 * Asset-файли буквеної аватарки учасника у шаблоні (assets/img/people/uN.svg) +
 * колір кружечка. Рендер підміняє src ЦИХ файлів: фото-аватарка → data:-URL,
 * перейменування без фото → SVG-літера того ж кольору. Один учасник має той
 * самий аватар у плитці (m0DVAf+SOQwsf), панелі «Люди» (KjWwNd), кружечках
 * «Ще 3 особи» (qg7mD) та бейджі People (Qw4c9e).
 */
export const PARTICIPANT_ASSETS: Record<string, { files: string[]; color: string }> = {
  [`${TEMPLATE_SPACE}/devices/316`]: { files: ['u4', 'u5', 'u22', 'u0'], color: '#8d6e63' }, // Sandro
  [`${TEMPLATE_SPACE}/devices/295`]: { files: ['u6', 'u7', 'u23', 'u2'], color: '#00897b' }, // Анатолій
  [`${TEMPLATE_SPACE}/devices/296`]: { files: ['u8', 'u9', 'u25', 'u3'], color: '#33691e' }, // Валерій
  [`${TEMPLATE_SPACE}/devices/297`]: { files: ['u10', 'u11', 'u30', 'u1'], color: '#7e57c2' }, // Олександр
  [`${TEMPLATE_SPACE}/devices/298`]: { files: ['u12', 'u13', 'u29'], color: '#33691e' }, // Михайло
  [`${TEMPLATE_SPACE}/devices/299`]: { files: ['u14', 'u15', 'u24'], color: '#c2185b' }, // Андрій
  [`${TEMPLATE_SPACE}/devices/300`]: { files: ['u16', 'u17', 'u31'], color: '#01579b' }, // Федір
  [`${TEMPLATE_SPACE}/devices/301`]: { files: ['u18', 'u19', 'u32'], color: '#689f38' }, // Юрій
  [`${TEMPLATE_SPACE}/devices/302`]: { files: ['u20', 'u27'], color: '#8d6e63' }, // Кирило («Ще 3 особи»)
  [`${TEMPLATE_SPACE}/devices/306`]: { files: ['u21', 'u26'], color: '#00897b' }, // Денис («Ще 3 особи»)
  [`${TEMPLATE_SPACE}/devices/307`]: { files: ['u28'], color: '#455a64' }, // Максим (лише панель)
};

/**
 * Палітра підложок буквених кружечків (кольори зі скріншота еталона — канонічні
 * аватарні кольори Meet). Рендер детерміновано «рандомить» їх ПО ГРУПІ:
 * та сама група → ті самі кольори на тих самих місцях у «початку» і «кінці».
 * Sandro (закріплена плитка) палітрою не зачіпається — завжди #8d6e63.
 */
export const LETTER_COLORS = [
  '#00897b', // teal
  '#33691e', // dark olive
  '#7e57c2', // purple
  '#c2185b', // magenta
  '#01579b', // navy blue
  '#689f38', // green
  '#455a64', // blue grey
  '#8d6e63', // brown
  '#e65100', // deep orange
  '#00838f', // dark cyan
  '#5e35b1', // deep purple
  '#ad1457', // dark pink
];

/** Колір Sandro Machaidze — закріплений (плитка і панель «1 в 1» зі скріншотом). */
export const SANDRO_DEVICE = `${TEMPLATE_SPACE}/devices/316`;
export const SANDRO_COLOR = '#8d6e63';

// 11 дефолтних учасників: Sandro (316, презентер) + 295–301 (плитки-фото) +
// 302/306/307 («інші» — у рендері йдуть у плитку «Ще N осіб»). ЖОДЕН не skipped:
// «пропуск» — суто користувацький прапор «не показувати в рендері/скріні» (skipped
// слоти render.ts ВИКЛЮЧАЄ). Девайс 320 (презентація Sandro) НЕ сідиться — це той
// самий Sandro. («Інші» визначаються за слотом без файла ролі tile, не за skipped.)
export function defaultParticipants(): DefaultParticipant[] {
  const p = (n: number, name: string, skipped = false): DefaultParticipant => ({
    device_id: `${TEMPLATE_SPACE}/devices/${n}`,
    original_name: name === 'Sandro Machaidze' ? name : utf8ToLatin1(name),
    custom_name: name,
    skipped,
  });
  return [
    p(316, 'Sandro Machaidze'),
    p(295, 'Анатолій'),
    p(296, 'Валерій'),
    p(297, 'Олександр'),
    p(298, 'Михайло'),
    p(299, 'Андрій'),
    p(300, 'Федір'),
    p(301, 'Юрій'),
    p(302, 'Кирило'),
    p(306, 'Денис'),
    p(307, 'Максим'),
  ];
}

// ─── Групи учасників ──────────────────────────────────────────────────────────────
export const DEFAULT_GROUP_NAME = 'Група 1';

// ─── Дефолтні налаштування ────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS: Record<string, string> = {
  // Активна група: її учасники йдуть у рендер і скріни.
  active_group_id: '1',
  // 24-годинний формат (як в Україні), без AM/PM.
  start_time: '13:41',
  end_time: '14:22',
  meeting_code: 'mqy-kiph-fci',
  openrouter_api_key: '',
  gen_model: DEFAULT_GEN_MODEL,
  gen_provider: DEFAULT_GEN_PROVIDER,
  gen_tier: DEFAULT_GEN_TIER,
  // Webcam-деградація аватарок: none|gd|gd-jpeg|css. none = дефолтний рендер байт-у-байт.
  cam_method: 'none',
  cam_intensity: '35',
  // Зменшення згенерованого фото під плитку Meet (cover, лише downscale).
  gen_resize: '1',
  gen_resize_w: '139',
  gen_resize_h: '185',
  // Авто-деградація щойно згенерованих картинок (бейк у воркері). Випадкова сила [min,max].
  gen_degrade: '1',
  gen_degrade_method: 'gd-jpeg',
  gen_degrade_min: '60',
  gen_degrade_max: '100',
};

export const SECRET_SETTING_KEYS = ['openrouter_api_key'];

export function allowedSettingKeys(): string[] {
  return Object.keys(DEFAULT_SETTINGS);
}

// ─── Emoji у реакц-тулбарі ─────────────────────────────────────────────────────────
// data-emoji у HTML — double-encoded mojibake; ключі будуємо тим самим перетворенням.
export function emojiCodepoints(): Record<string, string> {
  const real: Record<string, string> = {
    '💖': '1f496', '👍': '1f44d', '🎉': '1f389', '👏': '1f44f', '😂': '1f602',
    '😮': '1f62e', '😢': '1f622', '🤔': '1f914', '👎': '1f44e', '🍆': '1f346',
  };
  const out: Record<string, string> = {};
  for (const [e, code] of Object.entries(real)) {
    out[latin1ToUtf8(e)] = code;
  }
  return out;
}

// MIME за розширенням — для статики renderer.
export const STATIC_CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  json: 'application/json; charset=utf-8',
};
