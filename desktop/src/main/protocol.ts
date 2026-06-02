/**
 * Кастомний привілейований протокол app:// — віддає REST (/api/*) через ported
 * роутер і статику renderer (3 HTML + assets). Замінює php -S + serve_file.
 * Реальний origin (app://meet) дає relative-URL/iframe/fetch як у HTTP.
 */
import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { dispatch, makeRequest, MeetResponse } from './http';
import { rendererDir } from './services/paths';
import { STATIC_CONTENT_TYPES } from './services/config';

function serveStatic(rawPathname: string): MeetResponse {
  let rel = decodeURIComponent(rawPathname.replace(/^\/+/, ''));
  if (rel === '') rel = 'index.html';
  const dir = rendererDir();
  const target = path.normalize(path.join(dir, rel));
  // Захист від виходу за межі renderer.
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    return MeetResponse.text('forbidden', 403);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return MeetResponse.text('not found', 404);
  }
  const ext = path.extname(target).slice(1).toLowerCase();
  const ctype = STATIC_CONTENT_TYPES[ext] ?? 'application/octet-stream';
  return new MeetResponse(200, fs.readFileSync(target), ctype);
}

function toWeb(res: MeetResponse): Response {
  const headers = new Headers(res.headers);
  headers.set('Content-Type', res.contentType);
  const body = typeof res.body === 'string' ? res.body : new Uint8Array(res.body);
  return new Response(body, { status: res.status, headers });
}

export function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname; // %2F у device_id лишається кодованим — це ок
      if (pathname.startsWith('/api/')) {
        const rawBody = Buffer.from(await request.arrayBuffer());
        const req = makeRequest(request.method, pathname, url.searchParams, rawBody);
        const res = await dispatch(req);
        return toWeb(res);
      }
      if (request.method === 'GET') {
        return toWeb(serveStatic(pathname));
      }
      return new Response('no route', { status: 404 });
    } catch (e: any) {
      return new Response('server error: ' + (e?.message ?? String(e)), { status: 500 });
    }
  });
}
