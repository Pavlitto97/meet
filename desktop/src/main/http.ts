/**
 * HTTP-абстракції для протоколу app:// (порт meeteditor/http.php).
 * Хендлери тонкі — повертають MeetResponse або масив (→ JSON; _status = код помилки).
 */

export class MeetResponse {
  constructor(
    public status = 200,
    public body: Buffer | string = '',
    public contentType = 'application/octet-stream',
    public headers: Record<string, string> = {}
  ) {}

  static json(payload: unknown, status = 200, headers: Record<string, string> = {}): MeetResponse {
    return new MeetResponse(status, JSON.stringify(payload), 'application/json; charset=utf-8', headers);
  }

  static text(body: string, status = 200, contentType = 'text/plain; charset=utf-8', headers: Record<string, string> = {}): MeetResponse {
    return new MeetResponse(status, body, contentType, headers);
  }
}

export interface MeetRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  rawBody: Buffer;
  json(): any;
  q(key: string, def?: string | null): string | null;
}

type HandlerResult = MeetResponse | Record<string, any> | string | null;
type Handler = (req: MeetRequest) => HandlerResult | Promise<HandlerResult>;

const routes: { method: string; rx: RegExp; fn: Handler }[] = [];

/** Реєстрація маршруту. pattern — regex без якорів; іменовані групи (?<id>…) → params. */
export function route(method: string, pattern: string, fn: Handler): void {
  routes.push({ method: method.toUpperCase(), rx: new RegExp('^' + pattern + '$'), fn });
}

function coerce(result: HandlerResult): MeetResponse {
  if (result instanceof MeetResponse) return result;
  if (result && typeof result === 'object') {
    let status = 200;
    const obj = result as Record<string, any>;
    if ('_status' in obj) {
      status = Number(obj._status);
      delete obj._status;
    }
    return MeetResponse.json(obj, status);
  }
  if (result === null || result === undefined) return MeetResponse.text('');
  return MeetResponse.text(String(result));
}

export async function dispatch(req: MeetRequest): Promise<MeetResponse> {
  for (const { method, rx, fn } of routes) {
    if (method !== req.method) continue;
    const m = rx.exec(req.path);
    if (m) {
      req.params = m.groups ? { ...m.groups } : {};
      return coerce(await fn(req));
    }
  }
  return MeetResponse.json({ error: 'no route' }, 404);
}

/** Будує MeetRequest із даних протоколу. */
export function makeRequest(method: string, path: string, query: URLSearchParams, rawBody: Buffer): MeetRequest {
  let jsonCache: any = null;
  let parsed = false;
  return {
    method: method.toUpperCase(),
    path,
    query,
    params: {},
    rawBody,
    json() {
      if (!parsed) {
        parsed = true;
        try {
          jsonCache = rawBody.length ? JSON.parse(rawBody.toString('utf8')) : {};
        } catch {
          jsonCache = {};
        }
        if (typeof jsonCache !== 'object' || jsonCache === null) jsonCache = {};
      }
      return jsonCache;
    },
    q(key: string, def: string | null = null) {
      const v = query.get(key);
      return v === null ? def : v;
    },
  };
}
