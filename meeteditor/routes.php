<?php
/**
 * Реєстрація всіх HTTP-маршрутів. Кожен хендлер тонкий — делегує у сервісні модулі.
 *
 * device_id у шляху URL-кодований (encodeURIComponent на фронті), тож rawurldecode-имо.
 * Хендлер повертає Response (бінарне/кастомне) або масив (→ JSON; ключ _status = код).
 */
namespace Meet;

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/participants.php';
require_once __DIR__ . '/render.php';
require_once __DIR__ . '/openrouter.php';
require_once __DIR__ . '/generations.php';
require_once __DIR__ . '/screenshots.php';
require_once __DIR__ . '/admin.php';

function req_did(Request $req): string
{
    return \rawurldecode($req->params['did']);
}

// ─── Налаштування ─────────────────────────────────────────────────────────────
route('GET', '/api/settings', fn(Request $r) => get_settings());
route('PUT', '/api/settings', fn(Request $r) => update_settings($r->json()));

// ─── Промт + пресети ──────────────────────────────────────────────────────────
route('GET', '/api/prompt', fn(Request $r) => ['prompt' => \is_file(PROMPT_FILE) ? (string) \file_get_contents(PROMPT_FILE) : '']);
route('PUT', '/api/prompt', function (Request $r) {
    \file_put_contents(PROMPT_FILE, $r->json()['prompt'] ?? '');
    return ['ok' => true];
});
route('GET', '/api/prompt/presets', fn(Request $r) => list_presets());
route('POST', '/api/prompt/presets', fn(Request $r) => save_preset($r->json()['name'] ?? '', $r->json()['body'] ?? ''));
route('DELETE', '/api/prompt/presets/(?P<pid>\d+)', fn(Request $r) => delete_preset((int) $r->params['pid']));

// ─── Учасники ─────────────────────────────────────────────────────────────────
route('GET', '/api/participants', fn(Request $r) => list_participants());
route('POST', '/api/participants/reorder', fn(Request $r) => reorder($r->json()['order'] ?? null));
route('POST', '/api/participants', fn(Request $r) => create_participant($r->json()));
route('PUT', '/api/participants/(?P<did>.+)', fn(Request $r) => update_participant(req_did($r), $r->json()));
route('DELETE', '/api/participants/(?P<did>.+)', function (Request $r) {
    $hard = \in_array($r->q('hard', '0'), ['1', 'true'], true);
    return delete_participant(req_did($r), $hard);
});
route('GET', '/api/avatar/(?P<did>.+)', function (Request $r) {
    $which = $r->q('which', 'start');
    $res = avatar_blob(req_did($r), $which);
    if (!$res) {
        return Response::text('no avatar', 404);
    }
    [$blob, $mime] = $res;
    return new Response(200, $blob, $mime, ['Cache-Control' => 'no-store']);
});

// ─── Рендер ───────────────────────────────────────────────────────────────────
route('GET', '/api/render', function (Request $r) {
    $which = $r->q('which', 'start');
    // ?fit=ШИРИНАxВИСОТА (опційно) — масштабувати рендер під вікно скріна, щоб не
    // було білих полос. Без fit — байт-у-байт ідентичний дефолтний вивід.
    $fit = $r->q('fit');
    $html = render_meet($which, $fit !== '' ? $fit : null);
    $headers = [];
    if ($r->q('download')) {
        $headers['Content-Disposition'] = 'attachment; filename="meet-' . $which . '.html"';
    }
    return new Response(200, $html, 'text/html; charset=utf-8', $headers);
});

// ─── OpenRouter ───────────────────────────────────────────────────────────────
route('GET', '/api/credits', function (Request $r) {
    $apiKey = get_setting('openrouter_api_key');
    if ($apiKey === '') {
        return ['error' => 'API key не задано', '_status' => 400];
    }
    try {
        return fetch_credits($apiKey);
    } catch (OpenRouterHttpError $e) {
        return ['error' => "HTTP {$e->httpCode}: {$e->httpBody}", '_status' => $e->httpCode];
    } catch (\Throwable $e) {
        return ['error' => $e->getMessage(), '_status' => 500];
    }
});

// ─── Генерації ────────────────────────────────────────────────────────────────
route('GET', '/api/generations', fn(Request $r) => list_generations($r->q('participant_id'), $r->q('status')));
route('POST', '/api/generate', fn(Request $r) => create_generation($r->json()));
route('GET', '/api/generation-image/(?P<gid>\d+)', function (Request $r) {
    $res = generation_image((int) $r->params['gid']);
    if (!$res) {
        return Response::text('no image', 404);
    }
    [$blob, $mime] = $res;
    return new Response(200, $blob, $mime, ['Cache-Control' => 'no-store']);
});
route('GET', '/api/generation-input/(?P<gid>\d+)', function (Request $r) {
    $res = generation_input((int) $r->params['gid']);
    if (!$res) {
        return Response::text('no input', 404);
    }
    [$blob, $mime] = $res;
    return new Response(200, $blob, $mime, ['Cache-Control' => 'no-store']);
});
route('POST', '/api/generations/(?P<gid>\d+)/approve', fn(Request $r) => approve_generation((int) $r->params['gid'], $r->json()['which'] ?? 'start'));
route('POST', '/api/generations/(?P<gid>\d+)/regenerate', fn(Request $r) => regenerate((int) $r->params['gid']));
route('POST', '/api/generations/bulk-delete', fn(Request $r) => bulk_delete_generations($r->json()['scope'] ?? ''));
route('DELETE', '/api/generations/(?P<gid>\d+)', fn(Request $r) => delete_generation((int) $r->params['gid']));

// ─── Скріни (headless Chrome) ───────────────────────────────────────────────────
route('POST', '/api/screenshots', function (Request $r) {
    $b = $r->json();
    return capture($b['which'] ?? 'start', $b['width'] ?? 1280, $b['height'] ?? 720, $b['label'] ?? null);
});
route('GET', '/api/screenshots', fn(Request $r) => list_screenshots($r->q('which')));
route('GET', '/api/screenshot-image/(?P<sid>\d+)', function (Request $r) {
    $res = screenshot_image((int) $r->params['sid']);
    if (!$res) {
        return Response::text('no image', 404);
    }
    [$blob, $mime] = $res;
    $headers = ['Cache-Control' => 'no-store'];
    if ($r->q('download')) {
        $headers['Content-Disposition'] = 'attachment; filename="meet-screenshot-' . $r->params['sid'] . '.png"';
    }
    return new Response(200, $blob, $mime, $headers);
});
route('POST', '/api/screenshots/bulk-delete', fn(Request $r) => bulk_delete_screenshots($r->json()['scope'] ?? ''));
route('DELETE', '/api/screenshots/(?P<sid>\d+)', fn(Request $r) => delete_screenshot((int) $r->params['sid']));

// ─── Адмінка ──────────────────────────────────────────────────────────────────
route('GET', '/api/admin/stats', fn(Request $r) => dashboard_stats());
route('GET', '/api/admin/system', fn(Request $r) => system_info());
route('GET', '/api/admin/db', fn(Request $r) => db_stats());
route('POST', '/api/admin/db/vacuum', fn(Request $r) => vacuum());
route('POST', '/api/admin/db/reset', fn(Request $r) => reset_db($r->json()['confirm'] ?? ''));
route('POST', '/api/admin/restore-index', fn(Request $r) => restore_index($r->json()['confirm'] ?? ''));
route('GET', '/api/admin/activity', fn(Request $r) => list_activity($r->q('limit', 100)));
route('GET', '/api/admin/export', function (Request $r) {
    $resp = Response::json(export_state());
    if ($r->q('download')) {
        $resp->headers['Content-Disposition'] = 'attachment; filename="meet-export.json"';
    }
    return $resp;
});
route('POST', '/api/admin/import', fn(Request $r) => import_state($r->json()));
route('GET', '/api/admin/backup', function (Request $r) {
    if (!\is_file(DB_PATH)) {
        return Response::text('no db', 404);
    }
    return new Response(200, (string) \file_get_contents(DB_PATH), 'application/octet-stream', [
        'Content-Disposition' => 'attachment; filename="data.db"',
        'Cache-Control'       => 'no-store',
    ]);
});
