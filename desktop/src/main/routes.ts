/**
 * Реєстрація всіх маршрутів. Кожен хендлер тонкий — делегує у сервісний модуль.
 * Учасники адресуються числовим id і живуть у групах (services/groups).
 */
import fs from 'node:fs';
import { route, MeetResponse, type MeetRequest } from './http';
import { all, run } from './services/db';
import { promptFile } from './services/paths';
import { getSettings, updateSettings, getSetting } from './services/settings';
import {
  listParticipants,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  restoreParticipant,
  reorder,
  participantImage,
  cropParticipantImage,
  type ImageWhich,
} from './services/participants';
import {
  listGroups,
  createGroup,
  renameGroup,
  deleteGroup,
  activateGroup,
  resolveGroupId,
  groupSlide,
  setGroupSlide,
} from './services/groups';
import { renderMeet } from './services/render';
import { fetchCredits, OpenRouterHttpError } from './services/openrouter';
import {
  createGeneration,
  listGenerations,
  generationImage,
  generationInput,
  approveGeneration,
  cropGeneration,
  retouchGeneration,
  restoreGenerationImage,
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

const binOrNull = (res: [Buffer, string] | null, headers: Record<string, string> = { 'Cache-Control': 'no-store' }) =>
  res ? new MeetResponse(200, res[0], res[1], headers) : MeetResponse.text('no image', 404);
const intParam = (r: MeetRequest, name: string) => parseInt(r.params[name], 10);

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

// ─── Групи ────────────────────────────────────────────────────────────────────
route('GET', '/api/groups', () => listGroups());
route('POST', '/api/groups', (r) => createGroup(r.json()));
route('PUT', '/api/groups/(?<gid>\\d+)', (r) => renameGroup(intParam(r, 'gid'), r.json()));
route('DELETE', '/api/groups/(?<gid>\\d+)', (r) => deleteGroup(intParam(r, 'gid')));
route('POST', '/api/groups/(?<gid>\\d+)/activate', (r) => activateGroup(intParam(r, 'gid')));
// Слайд презентації групи: зображення для відео-області шаблону.
route('GET', '/api/groups/(?<gid>\\d+)/slide', (r) => binOrNull(groupSlide(intParam(r, 'gid'))));
route('PUT', '/api/groups/(?<gid>\\d+)/slide', (r) => setGroupSlide(intParam(r, 'gid'), r.json()));
route('DELETE', '/api/groups/(?<gid>\\d+)/slide', (r) => setGroupSlide(intParam(r, 'gid'), { slide_data_url: null }));

// ─── Учасники (в межах групи; ?group= або активна) ────────────────────────────
route('GET', '/api/participants', (r) => {
  const gid = resolveGroupId(r.q('group'));
  if (typeof gid !== 'number') return gid;
  // ?deleted=1 → лише м'яко видалені слоти (для секції відновлення).
  return listParticipants(gid, ['1', 'true', 'only'].includes(String(r.q('deleted', '0'))) ? 'only' : 'active');
});
route('POST', '/api/participants/reorder', (r) => {
  const b = r.json();
  const gid = resolveGroupId(b.group_id);
  if (typeof gid !== 'number') return gid;
  return reorder(gid, b.order ?? null);
});
route('POST', '/api/participants', (r) => {
  const b = r.json();
  const gid = resolveGroupId(b.group_id);
  if (typeof gid !== 'number') return gid;
  return createParticipant(gid, b);
});
route('PUT', '/api/participants/(?<pid>\\d+)', (r) => updateParticipant(intParam(r, 'pid'), r.json()));
// user_added → назавжди; дефолтний слот → м'яко (deleted=1, можна відновити).
route('DELETE', '/api/participants/(?<pid>\\d+)', (r) => deleteParticipant(intParam(r, 'pid')));
route('POST', '/api/participants/(?<pid>\\d+)/restore', (r) => restoreParticipant(intParam(r, 'pid')));
route('GET', '/api/avatar/(?<pid>\\d+)', (r) => {
  const raw = String(r.q('which', 'start'));
  const which: ImageWhich = raw === 'end' || raw === 'source' ? raw : 'start';
  const res = participantImage(intParam(r, 'pid'), which);
  if (!res) return MeetResponse.text('no avatar', 404);
  return new MeetResponse(200, res[0], res[1], { 'Cache-Control': 'no-store' });
});
// Кроп ВЛАСНОГО зображення учасника (коли немає генерації, з якої різати):
// вирізає область `from`-зображення (start|end|source) → аватарка `which`.
route('POST', '/api/participants/(?<pid>\\d+)/crop', (r) => {
  const b = r.json();
  const fromRaw = String(b.from ?? 'start');
  const from: ImageWhich = fromRaw === 'end' || fromRaw === 'source' ? fromRaw : 'start';
  const which = b.which === 'end' ? 'end' : 'start';
  const rect = { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) };
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    return { error: 'x/y/width/height мають бути числами', _status: 400 };
  }
  return cropParticipantImage(intParam(r, 'pid'), from, which, rect);
});

// ─── Рендер ───────────────────────────────────────────────────────────────────
route('GET', '/api/render', async (r) => {
  const which = String(r.q('which', 'start'));
  const fit = r.q('fit');
  const cam = r.q('cam');
  const group = r.q('group');
  const html = await renderMeet(which, fit || null, cam || null, group || null);
  const headers: Record<string, string> = {};
  if (r.q('download')) headers['Content-Disposition'] = `attachment; filename="meet-${which}.html"`;
  return new MeetResponse(200, html, 'text/html; charset=utf-8', headers);
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
route('GET', '/api/generations', (r) => listGenerations(r.q('participant_id'), r.q('status'), r.q('group')));
route('POST', '/api/generate', (r) => createGeneration(r.json()));
route('GET', '/api/generation-image/(?<gid>\\d+)', (r) => binOrNull(generationImage(intParam(r, 'gid'))));
route('GET', '/api/generation-input/(?<gid>\\d+)', (r) => binOrNull(generationInput(intParam(r, 'gid'))));
route('POST', '/api/generations/(?<gid>\\d+)/approve', (r) => {
  const raw = String(r.json().side ?? 'both');
  const side = raw === 'start' || raw === 'end' ? raw : 'both';
  return approveGeneration(intParam(r, 'gid'), side);
});
route('POST', '/api/generations/(?<gid>\\d+)/crop', (r) => {
  const b = r.json();
  const which = b.which === 'end' ? 'end' : 'start';
  const rect = { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) };
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) {
    return { error: 'x/y/width/height мають бути числами', _status: 400 };
  }
  return cropGeneration(intParam(r, 'gid'), which, rect);
});
// Ретуш (блюр/пікселізація/замазування у рендерері): перезаписує image генерації,
// оригінал відкладається в image_orig; restore-image повертає його назад.
route('POST', '/api/generations/(?<gid>\\d+)/retouch', (r) => retouchGeneration(intParam(r, 'gid'), r.json().image_data_url));
route('POST', '/api/generations/(?<gid>\\d+)/restore-image', (r) => restoreGenerationImage(intParam(r, 'gid')));
route('POST', '/api/generations/(?<gid>\\d+)/regenerate', (r) => regenerate(intParam(r, 'gid')));
route('POST', '/api/generations/bulk-delete', (r) => bulkDeleteGenerations(String(r.json().scope ?? '')));
route('DELETE', '/api/generations/(?<gid>\\d+)', (r) => deleteGeneration(intParam(r, 'gid')));

// ─── Скріни (webContents.capturePage) ───────────────────────────────────────────
route('POST', '/api/screenshots', (r) => {
  const b = r.json();
  // Дефолт — еталонна пропорція шаблону (2555×1267), без розтягування під 16:9.
  return capture(b.which ?? 'start', b.width ?? 2555, b.height ?? 1267, b.label ?? null, b.cam ?? null);
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
