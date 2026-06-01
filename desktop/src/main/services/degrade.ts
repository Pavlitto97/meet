/**
 * «Webcam-деградація» аватарок (порт meeteditor/degrade.php) — GD замінено на sharp.
 *
 * УВАГА (калібрування): sharp ≠ GD байт-у-байт. Криві сили (sigma blur, шум,
 * якість JPEG) — наближення GD-конвеєра; фінальне калібрування робиться в
 * degrade-lab.html. CSS-метод (browser) портований формула-в-формулу.
 *
 * Жоден метод не застосовується, поки cam не передано явно (none) — тож дефолтний
 * рендер лишається байт-у-байт (памʼятка dont-touch-render-output).
 */
import sharp from 'sharp';
import { getSettings } from './settings';

export interface DegradeMethod {
  key: string;
  label: string;
  layer: 'none' | 'server' | 'browser';
  desc: string;
}

const METHODS: DegradeMethod[] = [
  { key: 'none', label: 'Без обробки', layer: 'none', desc: 'Оригінал як є — байт-у-байт.' },
  { key: 'gd', label: 'GD · повна вебка', layer: 'server', desc: 'Downscale → колір/AWB → blur → шум → low-q JPEG. Найвища достовірність, бейк у пікселі.' },
  { key: 'gd-jpeg', label: 'GD · лише кодек', layer: 'server', desc: 'Тільки downscale + багатопрохідний low-q JPEG — чистий «поганий бітрейт», без шуму/кольору.' },
  { key: 'css', label: 'CSS-фільтр', layer: 'browser', desc: 'blur/contrast/brightness/saturate/sepia/hue — найдешевше, але БЕЗ шуму й блокінгу.' },
];
const METHOD_KEYS = new Set(METHODS.map((m) => m.key));
const METHOD_LAYER = new Map(METHODS.map((m) => [m.key, m.layer]));

export function degradeMethods(): DegradeMethod[] {
  return METHODS;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clampQ = (q: number) => Math.max(1, Math.min(100, q));

/** "gd:40" → {method:'gd', intensity:0.4}. Невідомий метод → none. */
export function parseCam(cam: string | null | undefined): { method: string; intensity: number } {
  let method = 'none';
  let I = 0.35;
  if (cam) {
    const idx = cam.indexOf(':');
    const head = idx === -1 ? cam : cam.slice(0, idx);
    const tail = idx === -1 ? '' : cam.slice(idx + 1);
    method = head.trim().toLowerCase();
    if (tail.trim() !== '' && !Number.isNaN(Number(tail))) {
      const v = Number(tail);
      I = v > 1 ? v / 100 : v;
    }
  }
  if (!METHOD_KEYS.has(method)) method = 'none';
  return { method, intensity: clamp01(I) };
}

export function camLayer(method: string): string {
  return METHOD_LAYER.get(method) ?? 'none';
}
export const camIsServer = (m: string) => camLayer(m) === 'server';
export const camIsBrowser = (m: string) => camLayer(m) === 'browser';

// ─── Серверна обробка (sharp) ───────────────────────────────────────────────────

/** Деградує байти під «погану вебку» → JPEG-байти. variant: 'full' | 'jpeg'. */
export async function webcamize(bytes: Buffer, intensity: number, variant: 'full' | 'jpeg' = 'full'): Promise<Buffer> {
  const I = clamp01(intensity);
  if (I <= 0) return bytes;
  let w = 0, h = 0;
  try {
    const meta = await sharp(bytes).metadata();
    w = meta.width ?? 0;
    h = meta.height ?? 0;
  } catch {
    return bytes; // битий / непідтримуваний
  }
  if (w < 2 || h < 2) return bytes;

  // (1) DOWNSCALE→UPSCALE — головний «мильний» детайл.
  const f = 0.65 - 0.3 * I;
  const sw = Math.max(1, Math.round(w * f));
  let work: Buffer;
  try {
    const small = await sharp(bytes).resize({ width: sw }).toBuffer();
    work = await sharp(small).resize(w, h, { fit: 'fill' }).toBuffer();
  } catch {
    return bytes;
  }

  if (variant === 'full') {
    try {
      // (2) колір/AWB-каст + плоский контраст; (3) blur.
      work = await sharp(work)
        .modulate({ brightness: 1 - 0.05 * I, saturation: 1 - 0.12 * I, hue: Math.round(-4 * I) })
        .linear(1 - 0.22 * I, Math.round(128 * 0.22 * I))
        .blur(0.4 + 1.1 * I)
        .toBuffer();
      // (4) ШУМ — half-res gaussian-оверлей, апскейл, blend overlay.
      const nw = Math.max(1, Math.round(w / 2));
      const nh = Math.max(1, Math.round(h / 2));
      const noise = await sharp({
        create: {
          width: nw,
          height: nh,
          channels: 3,
          background: { r: 128, g: 128, b: 128 },
          noise: { type: 'gaussian', mean: 128, sigma: 14 + 26 * I },
        },
      })
        .resize(w, h, { fit: 'fill' })
        .png()
        .toBuffer();
      work = await sharp(work).composite([{ input: noise, blend: 'overlay' }]).toBuffer();
    } catch {
      /* лишаємо work як є */
    }
  }

  // (5) БАГАТОПРОХІДНИЙ LOW-Q JPEG — справжні 8×8 DCT-блоки.
  const q1 = Math.round(48 - 16 * I);
  const q2 = Math.round(42 - 14 * I);
  try {
    const b1 = await sharp(work).jpeg({ quality: clampQ(q1), chromaSubsampling: '4:2:0', mozjpeg: true }).toBuffer();
    return await sharp(b1).jpeg({ quality: clampQ(q2), chromaSubsampling: '4:2:0', mozjpeg: true }).toBuffer();
  } catch {
    return work;
  }
}

/** Пропорційно ЗМЕНШУЄ (лише downscale) під рамку tw×th (cover). [bytes, mime]. */
export async function resizeToCover(bytes: Buffer, mime: string, tw: number, th: number): Promise<[Buffer, string]> {
  if (tw < 1 || th < 1) return [bytes, mime];
  let w = 0, h = 0;
  try {
    const meta = await sharp(bytes).metadata();
    w = meta.width ?? 0;
    h = meta.height ?? 0;
  } catch {
    return [bytes, mime];
  }
  if (w < 1 || h < 1) return [bytes, mime];
  const scale = Math.max(tw / w, th / h); // cover
  if (scale >= 1.0) return [bytes, mime]; // вже не більше — не апскейлимо
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  try {
    const out = await sharp(bytes).resize(nw, nh, { fit: 'fill' }).jpeg({ quality: 92 }).toBuffer();
    return [out, 'image/jpeg'];
  } catch {
    return [bytes, mime];
  }
}

/** Зменшення під плитку Meet при збереженні аватара (settings gen_resize/w/h). */
export async function autoResizeForAvatar(blob: Buffer, mime: string): Promise<[Buffer, string]> {
  const s = getSettings(false);
  const on = String(s.gen_resize ?? '1');
  if (on === '' || on === '0') return [blob, mime];
  const w = parseInt(String(s.gen_resize_w ?? '139'), 10) || 139;
  const h = parseInt(String(s.gen_resize_h ?? '185'), 10) || 185;
  return resizeToCover(blob, mime, w, h);
}

/** Серверна обробка байтів за методом. Для browser-методів — без змін. */
export async function degradeBlob(bytes: Buffer, mime: string, method: string, intensity: number): Promise<[Buffer, string]> {
  if (intensity <= 0 || !camIsServer(method)) return [bytes, mime];
  const variant = method === 'gd-jpeg' ? 'jpeg' : 'full';
  return [await webcamize(bytes, intensity, variant), 'image/jpeg'];
}

// ─── Браузерна обробка (CSS) ───────────────────────────────────────────────────

export function camSpec(method: string, intensity: number): { filter: string; svg: string } {
  const I = clamp01(intensity);
  if (I <= 0 || !camIsBrowser(method)) {
    return { filter: '', svg: '' };
  }
  const blur = (0.3 + 1.0 * I).toFixed(2);
  const con = (1 - 0.15 * I).toFixed(3);
  const bri = (1 - 0.06 * I).toFixed(3);
  const sat = (1 - 0.15 * I).toFixed(3);
  const sep = (0.1 * I).toFixed(3);
  const hue = (-6 * I).toFixed(1);
  return {
    filter: `blur(${blur}px) contrast(${con}) brightness(${bri}) saturate(${sat}) sepia(${sep}) hue-rotate(${hue}deg)`,
    svg: '',
  };
}

/** Розмітка у <head> рендера для browser-методів. Порожньо інакше. */
export function camHeadMarkup(method: string, intensity: number): string {
  const spec = camSpec(method, intensity);
  if (spec.filter === '') return '';
  return spec.svg + '<style>.oZRSLe img.m0DVAf[src^="data:"]{filter:' + spec.filter + '!important;}</style>';
}
