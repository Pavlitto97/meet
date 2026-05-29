<?php
/**
 * Агрегати та операції для адмін-панелі.
 *
 * Статистика дашборду, інфо про систему/БД, експорт/імпорт стану, промт-пресети,
 * журнал активності та небезпечні операції (reset/restore/vacuum).
 */
namespace Meet;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/state.php';
require_once __DIR__ . '/screenshots.php';

// ─── Дашборд / статистика ─────────────────────────────────────────────────────

function dashboard_stats(): array
{
    $con = db();
    $p = one($con,
        "SELECT COUNT(*) AS total, "
        . "SUM(CASE WHEN skipped=0 THEN 1 ELSE 0 END) AS editable, "
        . "SUM(skipped) AS skipped, SUM(user_added) AS user_added, "
        . "SUM(CASE WHEN avatar IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar, "
        . "SUM(CASE WHEN avatar_end IS NOT NULL THEN 1 ELSE 0 END) AS with_avatar_end, "
        . "SUM(CASE WHEN custom_name IS NOT NULL AND custom_name!='' THEN 1 ELSE 0 END) AS named "
        . "FROM participants"
    );
    $g = one($con,
        "SELECT COUNT(*) AS total, "
        . "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, "
        . "SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done, "
        . "SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error, "
        . "COALESCE(SUM(cost_usd),0) AS total_cost FROM generations"
    );
    $presets = (int) one($con, 'SELECT COUNT(*) AS n FROM prompt_presets')['n'];
    $sc = one($con,
        "SELECT COUNT(*) AS total, "
        . "SUM(CASE WHEN which='start' THEN 1 ELSE 0 END) AS starts, "
        . "SUM(CASE WHEN which='end' THEN 1 ELSE 0 END) AS ends, "
        . "COALESCE(SUM(size_bytes),0) AS bytes FROM screenshots"
    );
    $byModel = all($con,
        "SELECT model, COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS cost "
        . "FROM generations GROUP BY model ORDER BY cost DESC"
    );
    $s = get_settings();
    return [
        'participants'  => $p,
        'generations'   => $g,
        'screenshots'   => $sc,
        'cost_by_model' => $byModel,
        'presets'       => $presets,
        'db_size_bytes' => \is_file(DB_PATH) ? \filesize(DB_PATH) : 0,
        'settings'      => [
            'meeting_code' => $s['meeting_code'] ?? null,
            'start'        => ($s['start_time'] ?? '') . ' ' . ($s['start_period'] ?? ''),
            'end'          => ($s['end_time'] ?? '') . ' ' . ($s['end_period'] ?? ''),
            'gen_model'    => $s['gen_model'] ?? null,
            'api_key_set'  => $s['openrouter_api_key_set'] ?? false,
        ],
    ];
}

// ─── Система ──────────────────────────────────────────────────────────────────

function system_info(): array
{
    $indexPresent = \is_file(MEET_HTML);
    $indexSize = $indexPresent ? \filesize(MEET_HTML) : 0;
    $indexParticipants = 0;
    if ($indexPresent) {
        $html = (string) \file_get_contents(MEET_HTML);
        $indexParticipants = \preg_match_all('#data-participant-id="#', $html);
    }
    $bakPresent = \is_file(MEET_HTML_BAK);
    $bakSize = $bakPresent ? \filesize(MEET_HTML_BAK) : 0;

    $count = fn($p) => \is_dir($p) ? \count(\glob($p . '/*')) : 0;
    $assets = ROOT . '/assets';
    $chromePath = find_chrome();
    return [
        'index_html' => ['present' => $indexPresent, 'size' => $indexSize, 'participant_ids' => $indexParticipants],
        'index_bak'  => ['present' => $bakPresent, 'size' => $bakSize],
        'chrome'     => ['available' => (bool) $chromePath, 'path' => $chromePath],
        'assets'     => [
            'fonts'  => $count($assets . '/fonts'),
            'img'    => $count($assets . '/img'),
            'emoji'  => $count($assets . '/img/emoji'),
            'vendor' => $count($assets . '/vendor'),
        ],
        'php'            => PHP_VERSION,
        'platform'       => \php_uname(),
        'port'           => port(),
        'uptime_seconds' => (int) \round(\microtime(true) - started_at()),
        'db_path'        => DB_PATH,
    ];
}

function db_stats(): array
{
    $tables = ['participants', 'settings', 'generations', 'prompt_presets', 'activity', 'screenshots'];
    $con = db();
    $counts = [];
    foreach ($tables as $t) {
        try {
            $counts[$t] = (int) one($con, "SELECT COUNT(*) AS n FROM $t")['n'];
        } catch (\PDOException $e) {
            $counts[$t] = null;
        }
    }
    $pageCount = (int) $con->query('PRAGMA page_count')->fetchColumn();
    $pageSize = (int) $con->query('PRAGMA page_size')->fetchColumn();
    $freelist = (int) $con->query('PRAGMA freelist_count')->fetchColumn();
    return [
        'rows'           => $counts,
        'size_bytes'     => \is_file(DB_PATH) ? \filesize(DB_PATH) : 0,
        'page_count'     => $pageCount,
        'page_size'      => $pageSize,
        'freelist_count' => $freelist,
    ];
}

function vacuum(): array
{
    db()->exec('VACUUM');
    log_activity('db.vacuum', '');
    return ['ok' => true, 'size_bytes' => \filesize(DB_PATH)];
}

function reset_db(string $confirm): array
{
    if ($confirm !== 'RESET') {
        return ['error' => "потрібен confirm: 'RESET'", '_status' => 400];
    }
    $con = db();
    foreach (['participants', 'settings', 'generations', 'prompt_presets', 'activity', 'screenshots'] as $t) {
        $con->exec("DROP TABLE IF EXISTS $t");
    }
    init_db();
    log_activity('db.reset', '');
    return ['ok' => true];
}

function restore_index(string $confirm): array
{
    if ($confirm !== 'RESTORE') {
        return ['error' => "потрібен confirm: 'RESTORE'", '_status' => 400];
    }
    if (!\is_file(MEET_HTML_BAK)) {
        return ['error' => 'index.html.bak не знайдено', '_status' => 404];
    }
    \copy(MEET_HTML_BAK, MEET_HTML);
    log_activity('index.restore', '');
    return ['ok' => true, 'size_bytes' => \filesize(MEET_HTML)];
}

// ─── Експорт / імпорт ───────────────────────────────────────────────────────────

function export_state(): array
{
    $s = get_settings(); // без секретів
    unset($s['openrouter_api_key_set']);
    $con = db();
    $prows = all($con,
        'SELECT device_id, original_name, custom_name, skipped, position, user_added, '
        . 'avatar, avatar_mime, avatar_end, avatar_end_mime FROM participants ORDER BY position'
    );
    $presets = all($con, 'SELECT name, body FROM prompt_presets ORDER BY name');
    $participants = [];
    foreach ($prows as $r) {
        $startUrl = ($r['avatar'] ?? null) !== null && !empty($r['avatar_mime'])
            ? blob_to_data_url($r['avatar_mime'], $r['avatar']) : null;
        $endUrl = ($r['avatar_end'] ?? null) !== null && !empty($r['avatar_end_mime'])
            ? blob_to_data_url($r['avatar_end_mime'], $r['avatar_end']) : null;
        $participants[] = [
            'device_id'           => $r['device_id'],
            'original_name'       => $r['original_name'],
            'custom_name'         => $r['custom_name'],
            'skipped'             => $r['skipped'],
            'position'            => $r['position'],
            'user_added'          => $r['user_added'],
            'avatar_data_url'     => $startUrl,
            'avatar_end_data_url' => $endUrl,
        ];
    }
    $prompt = \is_file(PROMPT_FILE) ? (string) \file_get_contents(PROMPT_FILE) : '';
    return [
        'version'      => 1,
        'settings'     => $s,
        'prompt'       => $prompt,
        'presets'      => $presets,
        'participants' => $participants,
    ];
}

function import_state($data): array
{
    if (!\is_array($data)) {
        return ['error' => 'очікувався JSON-обʼєкт', '_status' => 400];
    }
    // Спершу повністю валідуємо й розпарсюємо учасників У ПАМ'ЯТІ — до запису в БД.
    $parsed = [];
    foreach (($data['participants'] ?? []) as $p) {
        $did = $p['device_id'] ?? null;
        if (!$did) {
            continue;
        }
        try {
            $avatar = $avatarMime = $avatarEnd = $avatarEndMime = null;
            if (!empty($p['avatar_data_url'])) {
                [$avatarMime, $avatar] = parse_data_url($p['avatar_data_url']);
            }
            if (!empty($p['avatar_end_data_url'])) {
                [$avatarEndMime, $avatarEnd] = parse_data_url($p['avatar_end_data_url']);
            }
            if (isset($p['skipped']) && !\is_numeric($p['skipped']) && !\is_bool($p['skipped'])) {
                throw new \InvalidArgumentException('skipped не число');
            }
            if (isset($p['position']) && !\is_numeric($p['position'])) {
                throw new \InvalidArgumentException('position не число');
            }
            $skipped = (int) ($p['skipped'] ?? 0);
            $position = (int) ($p['position'] ?? 0);
        } catch (\InvalidArgumentException $e) {
            return ['error' => "невалідні дані учасника $did: " . $e->getMessage(), '_status' => 400];
        }
        $parsed[] = [
            'did'             => $did,
            'custom_name'     => $p['custom_name'] ?? null,
            'original_name'   => $p['original_name'] ?? ($p['custom_name'] ?? $did),
            'skipped'         => $skipped,
            'position'        => $position,
            'avatar'          => $avatar,
            'avatar_mime'     => $avatarMime,
            'avatar_end'      => $avatarEnd,
            'avatar_end_mime' => $avatarEndMime,
        ];
    }

    $counts = ['settings' => 0, 'participants_updated' => 0, 'participants_created' => 0, 'presets' => 0];
    $con = db();
    $con->beginTransaction();
    try {
        foreach (($data['settings'] ?? []) as $k => $v) {
            if (\array_key_exists($k, DEFAULT_SETTINGS)) {
                q($con, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                    [$k, $v === null ? '' : (string) $v]);
                $counts['settings']++;
            }
        }
        foreach (($data['presets'] ?? []) as $pr) {
            if (!empty($pr['name']) && ($pr['body'] ?? null) !== null) {
                q($con,
                    'INSERT INTO prompt_presets(name, body) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body, updated_at=CURRENT_TIMESTAMP',
                    [$pr['name'], $pr['body']]);
                $counts['presets']++;
            }
        }
        foreach ($parsed as $r) {
            $exists = one($con, 'SELECT 1 AS x FROM participants WHERE device_id = ?', [$r['did']]);
            if ($exists) {
                q($con,
                    'UPDATE participants SET custom_name=?, skipped=?, position=?, avatar=?, avatar_mime=?, '
                    . 'avatar_end=?, avatar_end_mime=?, updated_at=CURRENT_TIMESTAMP WHERE device_id=?',
                    [$r['custom_name'], $r['skipped'], $r['position'], $r['avatar'], $r['avatar_mime'],
                     $r['avatar_end'], $r['avatar_end_mime'], $r['did']]);
                $counts['participants_updated']++;
            } elseif (\str_starts_with($r['did'], 'local/')) {
                q($con,
                    'INSERT INTO participants(device_id, original_name, custom_name, skipped, position, user_added, '
                    . 'avatar, avatar_mime, avatar_end, avatar_end_mime) VALUES(?,?,?,?,?,1,?,?,?,?)',
                    [$r['did'], $r['original_name'], $r['custom_name'], $r['skipped'], $r['position'],
                     $r['avatar'], $r['avatar_mime'], $r['avatar_end'], $r['avatar_end_mime']]);
                $counts['participants_created']++;
            }
        }
        $con->commit();
    } catch (\Throwable $e) {
        $con->rollBack();
        throw $e;
    }
    if (isset($data['prompt']) && \is_string($data['prompt'])) {
        \file_put_contents(PROMPT_FILE, $data['prompt']);
    }
    log_activity('state.import', \json_encode($counts));
    return \array_merge(['ok' => true], $counts);
}

// ─── Промт-пресети ────────────────────────────────────────────────────────────

function list_presets(): array
{
    return all(db(), 'SELECT id, name, body, created_at, updated_at FROM prompt_presets ORDER BY name');
}

function save_preset(string $name, string $body): array
{
    $name = \trim($name);
    if ($name === '') {
        return ['error' => 'name required', '_status' => 400];
    }
    q(db(),
        'INSERT INTO prompt_presets(name, body) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body, updated_at=CURRENT_TIMESTAMP',
        [$name, $body]);
    log_activity('preset.save', $name);
    return ['ok' => true];
}

function delete_preset(int $presetId): array
{
    q(db(), 'DELETE FROM prompt_presets WHERE id = ?', [$presetId]);
    return ['ok' => true];
}

// ─── Журнал активності ──────────────────────────────────────────────────────────

function list_activity($limit = 100): array
{
    $limit = \max(1, \min((int) ($limit ?: 100), 500));
    return all(db(), 'SELECT id, ts, action, detail FROM activity ORDER BY id DESC LIMIT ?', [$limit]);
}
