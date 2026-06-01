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

/** Те саме, але з явних байтів (для імен із «загубленим» хвостовим байтом). */
function mojibakeOf(text: string, ...extraBytes: number[]): string {
  return mojibakeBytes(Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from(extraBytes)]));
}

// ─── OpenRouter ─────────────────────────────────────────────────────────────────
export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
export const DEFAULT_GEN_MODEL = 'google/gemini-2.5-flash-image';
export const DEFAULT_GEN_PROVIDER = 'google-ai-studio';
export const DEFAULT_GEN_TIER = 'flex';

// ─── Початкові значення у HTML (що саме шукати для заміни) ─────────────────────────
export const ORIGINAL_MEETING_CODE = 'yrt-kczi-csw';
export const ORIGINAL_TIME = '10:34';
export const ORIGINAL_PERIOD = 'PM';

export interface DefaultParticipant {
  device_id: string;
  original_name: string; // latin1-байтовий рядок (mojibake як у HTML)
  custom_name: string | null;
  skipped: boolean;
}

// Імена на «я» (Саня/Ваня/Даня): у збереженій сторінці загубився останній байт
// 0x8F → mojibake обривається на Ñ, тож pre-image = "Сан"+0xD1. Микола має
// хвостовий 0x5C (backslash). Pavlo/«3 others» (126/136-138) — skipped.
export function defaultParticipants(): DefaultParticipant[] {
  return [
    { device_id: 'spaces/mBsECBRYcS4B/devices/127', original_name: 'Sandro Machaidze', custom_name: 'Sandro Machaidze', skipped: false },
    { device_id: 'spaces/mBsECBRYcS4B/devices/129', original_name: mojibakeOf('Сан', 0xd1), custom_name: 'Саня', skipped: false },
    { device_id: 'spaces/mBsECBRYcS4B/devices/131', original_name: mojibakeOf('Ван', 0xd1), custom_name: 'Ваня', skipped: false },
    { device_id: 'spaces/mBsECBRYcS4B/devices/132', original_name: mojibakeOf('Дан', 0xd1), custom_name: 'Даня', skipped: false },
    { device_id: 'spaces/mBsECBRYcS4B/devices/133', original_name: latin1ToUtf8('Дима'), custom_name: 'Дима', skipped: false },
    { device_id: 'spaces/mBsECBRYcS4B/devices/134', original_name: latin1ToUtf8('Микита'), custom_name: 'Микита', skipped: false },
    { device_id: 'spaces/mBsECBRYcS4B/devices/135', original_name: mojibakeOf('Микола', 0x5c), custom_name: 'Микола', skipped: false },
    { device_id: 'spaces/mBsECBRYcS4B/devices/126', original_name: 'Pavlo Grinevich', custom_name: null, skipped: true },
    { device_id: 'spaces/mBsECBRYcS4B/devices/136', original_name: latin1ToUtf8('Гриша'), custom_name: null, skipped: true },
    { device_id: 'spaces/mBsECBRYcS4B/devices/137', original_name: latin1ToUtf8('Павло'), custom_name: null, skipped: true },
    { device_id: 'spaces/mBsECBRYcS4B/devices/138', original_name: latin1ToUtf8('Кирило'), custom_name: null, skipped: true },
  ];
}

// ─── Дефолтні налаштування ────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS: Record<string, string> = {
  start_time: '10:34',
  start_period: 'PM',
  end_time: '11:15',
  end_period: 'PM',
  meeting_code: 'yrt-kczi-csw',
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
