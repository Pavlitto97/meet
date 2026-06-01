/**
 * Реєстрація всіх маршрутів (порт meeteditor/routes.php). Ядро (settings, prompt,
 * participants, avatar, render, degrade, credits) — портоване повністю.
 * Генерації/скріни/адмін: читання з БД працює, важкі дії (генерація, capture,
 * адмін-агрегати) — 501-стаби до наступного кроку порту.
 */
import fs from 'node:fs';
import { route, MeetResponse, type MeetRequest } from './http';
import { all, one, run, toBuffer } from './services/db';
import { promptFile } from './services/paths';
import { getSettings, updateSettings, getSetting } from './services/settings';
import {
  listParticipants,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  reorder,
  avatarBlob,
} from './services/participants';
import { renderMeet } from './services/render';
import { degradeMethods, parseCam, camSpec, camLayer, degradeBlob } from './services/degrade';
import { fetchCredits, OpenRouterHttpError } from './services/openrouter';
import {
  createGeneration,
  listGenerations,
  generationImage,
  generationInput,
  approveGeneration,
  regenerate,
  deleteGeneration,
  bulkDeleteGenerations,
} from './services/generations';
import {
  capture,
  listScreenshots,
  screenshotImage,
  deleteScreenshot,
  bulkDeleteScreenshots,
} from './services/screenshots';
import {
  dashboardStats,
  systemInfo,
  dbStats,
  vacuum,
  resetDb,
  restoreIndex,
  exportState,
  importState,
} from './services/admin';
import { dbPath } from './services/paths';

const reqDid = (r: MeetRequest) => decodeURIComponent(r.params.did);
const binOrNull = (res: [Buffer, string] | null, headers: Record<string, string> = { 'Cache-Control': 'no-store' }) =>
  res ? new MeetResponse(200, res[0], res[1], headers) : MeetResponse.text('no image', 404);

// ─── Налаштування ─────────────────────────────────────────────────────────────
route('GET', '/api/settings', () => getSettings());
route('PUT', '/api/settings', (r) => updateSettings(r.json()));

// ─── Промт + пресети ──────────────────────────────────────────────────────────
route('GET', '/api/prompt', () => ({ prompt: fs.existsSync(promptFile()) ? fs.readFileSync(promptFile(), 'utf8') : '' }));
route('PUT', '/api/prompt', (r) => {
  fs.writeFileSync(promptFile(), String(r.json().prompt ?? ''));
  return { ok: true };
});
route('GET', '/api/prompt/presets', () => all('SELECT id, name, body, created_at, updated_at FROM prompt_presets ORDER BY name'));
route('POST', '/api/prompt/presets', (r) => {
  const b = r.json();
  const name = String(b.name ?? '').trim();
  if (!name) return { error: 'name required', _status: 400 };
  run(
    'INSERT INTO prompt_presets(name, body) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body, updated_at=CURRENT_TIMESTAMP',
    [name, String(b.body ?? '')]
  );
  return { ok: true };
});
route('DELETE', '/api/prompt/presets/(?<pid>\\d+)', (r) => {
  run('DELETE FROM prompt_presets WHERE id = ?', [parseInt(r.params.pid, 10)]);
  return { ok: true };
});

// ─── Учасники ─────────────────────────────────────────────────────────────────
route('GET', '/api/participants', () => listParticipants());
route('POST', '/api/participants/reorder', (r) => reorder(r.json().order ?? null));
route('POST', '/api/participants', (r) => createParticipant(r.json()));
route('PUT', '/api/participants/(?<did>.+)', (r) => updateParticipant(reqDid(r), r.json()));
route('DELETE', '/api/participants/(?<did>.+)', (r) => {
  const hard = ['1', 'true'].includes(String(r.q('hard', '0')));
  return deleteParticipant(reqDid(r), hard);
});
route('GET', '/api/avatar/(?<did>.+)', (r) => {
  const which = r.q('which', 'start') === 'end' ? 'end' : 'start';
  const res = avatarBlob(reqDid(r), which);
  if (!res) return MeetResponse.text('no avatar', 404);
  return new MeetResponse(200, res[0], res[1], { 'Cache-Control': 'no-store' });
});

// ─── Рендер ───────────────────────────────────────────────────────────────────
route('GET', '/api/render', async (r) => {
  const which = String(r.q('which', 'start'));
  const fit = r.q('fit');
  const cam = r.q('cam');
  const html = await renderMeet(which, fit || null, cam || null);
  const headers: Record<string, string> = {};
  if (r.q('download')) headers['Content-Disposition'] = `attachment; filename="meet-${which}.html"`;
  return new MeetResponse(200, html, 'text/html; charset=utf-8', headers);
});

// ─── Webcam-деградація ──────────────────────────────────────────────────────────
route('GET', '/api/degrade-methods', () => ({ methods: degradeMethods() }));
route('GET', '/api/degrade-spec', (r) => {
  const p = parseCam(r.q('cam'));
  const spec = camSpec(p.method, p.intensity);
  return { method: p.method, intensity: p.intensity, layer: camLayer(p.method), filter: spec.filter, svg: spec.svg };
});
route('GET', '/api/degrade-preview', async (r) => {
  const which = r.q('which', 'start') === 'end' ? 'end' : 'start';
  const gid = r.q('gid');
  let res: [Buffer, string] | null = null;
  if (gid) {
    const row = one('SELECT image AS blob, image_mime AS mime FROM generations WHERE id = ?', [parseInt(gid, 10)]);
    const b = toBuffer(row?.blob);
    res = row && b && row.mime ? [b, row.mime] : null;
  } else {
    const did = r.q('did');
    res = did ? avatarBlob(decodeURIComponent(did), which) : null;
  }
  if (!res) return MeetResponse.text('no image', 404);
  const p = parseCam(r.q('cam'));
  const [blob, mime] = await degradeBlob(res[0], res[1], p.method, p.intensity);
  return new MeetResponse(200, blob, mime, { 'Cache-Control': 'no-store' });
});

// ─── OpenRouter ───────────────────────────────────────────────────────────────
route('GET', '/api/credits', async () => {
  const key = getSetting('openrouter_api_key');
  if (key === '') return { error: 'API key не задано', _status: 400 };
  try {
    return await fetchCredits(key);
  } catch (e: any) {
    if (e instanceof OpenRouterHttpError) return { error: `HTTP ${e.httpCode}: ${e.httpBody}`, _status: e.httpCode };
    return { error: e?.message ?? String(e), _status: 500 };
  }
});

// ─── Генерації ────────────────────────────────────────────────────────────────
route('GET', '/api/generations', (r) => listGenerations(r.q('participant_id'), r.q('status')));
route('POST', '/api/generate', (r) => createGeneration(r.json()));
route('GET', '/api/generation-image/(?<gid>\\d+)', (r) => binOrNull(generationImage(parseInt(r.params.gid, 10))));
route('GET', '/api/generation-input/(?<gid>\\d+)', (r) => binOrNull(generationInput(parseInt(r.params.gid, 10))));
route('POST', '/api/generations/(?<gid>\\d+)/approve', (r) => approveGeneration(parseInt(r.params.gid, 10), r.json().which === 'end' ? 'end' : 'start'));
route('POST', '/api/generations/(?<gid>\\d+)/regenerate', (r) => regenerate(parseInt(r.params.gid, 10)));
route('POST', '/api/generations/bulk-delete', (r) => bulkDeleteGenerations(String(r.json().scope ?? '')));
route('DELETE', '/api/generations/(?<gid>\\d+)', (r) => deleteGeneration(parseInt(r.params.gid, 10)));

// ─── Скріни (webContents.capturePage) ───────────────────────────────────────────
route('POST', '/api/screenshots', (r) => {
  const b = r.json();
  return capture(b.which ?? 'start', b.width ?? 1280, b.height ?? 720, b.label ?? null, b.cam ?? null);
});
route('GET', '/api/screenshots', (r) => listScreenshots(r.q('which')));
route('GET', '/api/screenshot-image/(?<sid>\\d+)', (r) => {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (r.q('download')) headers['Content-Disposition'] = `attachment; filename="meet-screenshot-${r.params.sid}.png"`;
  return binOrNull(screenshotImage(parseInt(r.params.sid, 10)), headers);
});
route('POST', '/api/screenshots/bulk-delete', (r) => bulkDeleteScreenshots(String(r.json().scope ?? '')));
route('DELETE', '/api/screenshots/(?<sid>\\d+)', (r) => deleteScreenshot(parseInt(r.params.sid, 10)));

// ─── Адмінка ──────────────────────────────────────────────────────────────────
route('GET', '/api/admin/stats', () => dashboardStats());
route('GET', '/api/admin/system', () => systemInfo());
route('GET', '/api/admin/db', () => dbStats());
route('POST', '/api/admin/db/vacuum', () => vacuum());
route('POST', '/api/admin/db/reset', (r) => resetDb(String(r.json().confirm ?? '')));
route('POST', '/api/admin/restore-index', (r) => restoreIndex(String(r.json().confirm ?? '')));
route('GET', '/api/admin/activity', (r) => {
  const lim = Math.max(1, Math.min(parseInt(String(r.q('limit', '100')), 10) || 100, 500));
  return all('SELECT id, ts, action, detail FROM activity ORDER BY id DESC LIMIT ?', [lim]);
});
route('GET', '/api/admin/export', (r) => {
  const res = MeetResponse.json(exportState());
  if (r.q('download')) res.headers['Content-Disposition'] = 'attachment; filename="meet-export.json"';
  return res;
});
route('POST', '/api/admin/import', (r) => importState(r.json()));
route('GET', '/api/admin/backup', () => {
  if (!fs.existsSync(dbPath())) return MeetResponse.text('no db', 404);
  return new MeetResponse(200, fs.readFileSync(dbPath()), 'application/octet-stream', {
    'Content-Disposition': 'attachment; filename="data.db"',
    'Cache-Control': 'no-store',
  });
});

// Маршрути реєструються як side-effect імпорту цього модуля (index.ts: import './routes').
