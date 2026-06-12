/**
 * Клієнт OpenRouter (порт meeteditor/openrouter.php) — генерація зображень
 * (chat.completions з modalities) і баланс. Через нативний fetch (Node 24).
 */
import { OPENROUTER_URL, OPENROUTER_CREDITS_URL } from './config';
import { parseDataUrl } from './media';

/** HTTP-помилка від OpenRouter — несе код і тіло (для /api/credits). */
export class OpenRouterHttpError extends Error {
  constructor(public httpCode: number, public httpBody: string) {
    super(`HTTP ${httpCode}: ${httpBody}`);
    this.name = 'OpenRouterHttpError';
  }
}

/** 200 OK, але без зображення (текст/відмова). retryable=false для жорстких блоків. */
export class EmptyImageError extends Error {
  modelText: string | null;
  finishReason: string | null;
  retryable: boolean;
  constructor(modelText: string | null, finishReason: string | null, retryable: boolean) {
    const mt = modelText && modelText.trim() !== '' ? modelText.trim() : null;
    let msg = 'OpenRouter: модель не повернула зображення';
    if (finishReason) msg += ` (finish_reason=${finishReason})`;
    if (mt !== null) msg += '. Відповідь моделі: «' + mt.slice(0, 300) + '»';
    else msg += ' і без тексту — імовірно транзієнтний збій, спробуй ще раз.';
    super(msg);
    this.name = 'EmptyImageError';
    this.modelText = mt;
    this.finishReason = finishReason;
    this.retryable = retryable;
  }
}

export function orHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost/',
    'X-Title': 'Meet Editor',
  };
}

/** [status, body]. Кидає Error на мережеву помилку/таймаут. */
export async function orRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | null,
  timeoutSec: number
): Promise<[number, string]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      signal: ctrl.signal,
    });
    const text = await resp.text();
    return [resp.status, text];
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`таймаут запиту (${timeoutSec}s)`);
    throw new Error('мережева помилка: ' + (e?.message ?? String(e)));
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCredits(apiKey: string): Promise<any> {
  const [status, body] = await orRequest('GET', OPENROUTER_CREDITS_URL, orHeaders(apiKey), null, 30);
  if (status < 200 || status >= 300) {
    throw new OpenRouterHttpError(status, body);
  }
  return JSON.parse(body || '{}');
}

/** chat.completions з modalities=[text,image] → декодований JSON. */
export async function callImage(
  apiKey: string,
  model: string,
  provider: string,
  serviceTier: string,
  prompt: string,
  inputImageDataUrl: string | null,
  allowFallbacks = false
): Promise<any> {
  if (!model.toLowerCase().includes('image')) {
    throw new Error(
      `Модель «${model}» не підтримує генерацію зображень. ` +
        'Вибери модель з «image» в назві (напр. google/gemini-2.5-flash-image).'
    );
  }
  const content: any[] = [{ type: 'text', text: prompt }];
  if (inputImageDataUrl) {
    content.push({ type: 'image_url', image_url: { url: inputImageDataUrl } });
  }
  const payload: any = {
    model,
    modalities: ['text', 'image'],
    messages: [{ role: 'user', content }],
    image_config: { aspect_ratio: '16:9' },
    usage: { include: true },
  };
  if (serviceTier && serviceTier !== 'default') {
    payload.service_tier = serviceTier;
  }
  if (provider) {
    // allow_fallbacks=false → лише цей провайдер (точна воля користувача).
    // allow_fallbacks=true  → цей провайдер першим, але OpenRouter може
    // перемкнутись на інший, якщо цей rate-limited/недоступний (обхід 429).
    payload.provider = allowFallbacks
      ? { order: [provider], allow_fallbacks: true }
      : { only: [provider], allow_fallbacks: false };
  }
  // provider === '' → нічого не пінимо: OpenRouter сам маршрутизує по всіх
  // доступних провайдерах моделі (максимально надійний шлях).
  const [status, resp] = await orRequest('POST', OPENROUTER_URL, orHeaders(apiKey), JSON.stringify(payload), 180);
  if (status < 200 || status >= 300) {
    // OpenRouterHttpError несе код: 429/5xx ретраяться у runGeneration з бекофом.
    throw new OpenRouterHttpError(status, resp);
  }
  return JSON.parse(resp || '{}');
}

/** Текст відповіді моделі (refusal / рядковий content / text-частини) або null. */
export function extractText(msg: any): string | null {
  if (msg?.refusal && typeof msg.refusal === 'string') return msg.refusal;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (part && part.type === 'text' && part.text) texts.push(part.text);
    }
    return texts.length ? texts.join(' ') : null;
  }
  return null;
}

/** Перша картинка з відповіді → [mime, Buffer]. Кидає EmptyImageError якщо немає. */
export function extractImage(resp: any): [string, Buffer] {
  const choices = resp?.choices ?? [];
  if (!choices.length) throw new Error('OpenRouter: choices порожній');
  const msg = choices[0]?.message ?? {};
  for (const img of msg.images ?? []) {
    const url = img && typeof img === 'object' ? img.image_url?.url : null;
    if (url && String(url).startsWith('data:')) return parseDataUrl(url);
  }
  const content = msg.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && part.type === 'image_url') {
        const url = part.image_url?.url;
        if (url && String(url).startsWith('data:')) return parseDataUrl(url);
      }
    }
  }
  const finish = choices[0]?.finish_reason ?? null;
  const hardBlock = !!msg.refusal || finish === 'content_filter';
  throw new EmptyImageError(extractText(msg), finish, !hardBlock);
}
