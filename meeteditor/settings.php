<?php
/**
 * Читання/запис налаштувань зустрічі та AI-конфігу.
 *
 * Секретні поля (openrouter_api_key) назовні не віддаємо — лише прапорець
 * `<key>_set`, чи воно встановлене.
 */
namespace Meet;

require_once __DIR__ . '/db.php';

function get_settings(bool $includeSecrets = false): array
{
    $con = db();
    $rows = [];
    foreach (all($con, 'SELECT key, value FROM settings') as $r) {
        $rows[$r['key']] = $r['value'];
    }
    if ($includeSecrets) {
        return $rows;
    }
    $public = [];
    foreach ($rows as $k => $v) {
        if (\in_array($k, SECRET_SETTING_KEYS, true)) {
            continue;
        }
        $public[$k] = $v;
    }
    foreach (SECRET_SETTING_KEYS as $k) {
        $public[$k . '_set'] = !empty($rows[$k]);
    }
    return $public;
}

function get_setting(string $key): string
{
    $con = db();
    $row = one($con, 'SELECT value FROM settings WHERE key = ?', [$key]);
    return $row ? (string) $row['value'] : '';
}

/** Оновлює дозволені ключі. Повертає {ok:true, updated:[...]} або {error:...}. */
function update_settings(array $body): array
{
    $updates = [];
    foreach ($body as $k => $v) {
        if (\array_key_exists($k, DEFAULT_SETTINGS)) {
            $updates[$k] = $v;
        }
    }
    if (!$updates) {
        return ['error' => 'no allowed keys', '_status' => 400];
    }
    $con = db();
    foreach ($updates as $k => $v) {
        // Порожній рядок для секретів = очистити.
        $val = $v === null ? '' : (string) $v;
        q($con, 'INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [$k, $val]);
    }
    $keys = \array_keys($updates);
    \sort($keys);
    return ['ok' => true, 'updated' => $keys];
}
