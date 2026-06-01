<?php
/**
 * CRUD учасників: список, оновлення (ім'я/аватарки/skip/позиція), додавання,
 * видалення, перевпорядкування.
 */
namespace Meet;

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/degrade.php';

function list_participants(): array
{
    $con = db();
    return all($con,
        "SELECT device_id, original_name, custom_name, "
        . "avatar IS NOT NULL AS has_avatar, avatar_mime, "
        . "avatar_end IS NOT NULL AS has_avatar_end, avatar_end_mime, "
        . "skipped, user_added, position, updated_at "
        . "FROM participants ORDER BY position"
    );
}

/** [blob, mime] або null. */
function avatar_blob(string $did, string $which = 'start'): ?array
{
    $blobCol = $which === 'end' ? 'avatar_end' : 'avatar';
    $mimeCol = $which === 'end' ? 'avatar_end_mime' : 'avatar_mime';
    $con = db();
    $row = one($con, "SELECT $blobCol AS blob, $mimeCol AS mime FROM participants WHERE device_id = ?", [$did]);
    if (!$row || ($row['blob'] ?? null) === null || empty($row['mime'])) {
        return null;
    }
    return [$row['blob'], $row['mime']];
}

/**
 * Оновлює дозволені поля учасника. Повертає {ok} / {error,_status}.
 * Поля: custom_name, original_name, skipped, position,
 *       avatar_data_url, avatar_end_data_url (null = очистити).
 */
function update_participant(string $did, array $body): array
{
    $fields = [];
    if (\array_key_exists('custom_name', $body)) {
        $fields['custom_name'] = $body['custom_name'] !== '' && $body['custom_name'] !== null ? $body['custom_name'] : null;
    }
    if (\array_key_exists('original_name', $body)) {
        if (!empty($body['original_name'])) {
            $fields['original_name'] = (string) $body['original_name'];
        }
    }
    if (\array_key_exists('skipped', $body)) {
        $fields['skipped'] = $body['skipped'] ? 1 : 0;
    }
    if (\array_key_exists('position', $body)) {
        if (!\is_numeric($body['position'])) {
            return ['error' => 'position має бути числом', '_status' => 400];
        }
        $fields['position'] = (int) $body['position'];
    }
    foreach ([
        ['avatar_data_url', 'avatar', 'avatar_mime'],
        ['avatar_end_data_url', 'avatar_end', 'avatar_end_mime'],
    ] as [$bodyKey, $blobCol, $mimeCol]) {
        if (!\array_key_exists($bodyKey, $body)) {
            continue;
        }
        $v = $body[$bodyKey];
        if ($v === null) {
            $fields[$blobCol] = null;
            $fields[$mimeCol] = null;
        } else {
            try {
                [$mime, $blob] = parse_data_url((string) $v);
            } catch (\InvalidArgumentException $e) {
                return ['error' => "bad data URL for $bodyKey", '_status' => 400];
            }
            // Зменшуємо під розмір плитки Meet при збереженні (split-колаж,
            // завантаження). downscale-only — повторні PUT малого нічого не псують.
            [$blob, $mime] = auto_resize_for_avatar($blob, $mime);
            $fields[$mimeCol] = $mime;
            $fields[$blobCol] = $blob;
        }
    }
    if (!$fields) {
        return ['error' => 'nothing to update', '_status' => 400];
    }
    $sets = \implode(', ', \array_map(fn($k) => "$k = ?", \array_keys($fields)));
    $sets .= ', updated_at = CURRENT_TIMESTAMP';
    $con = db();
    $st = q($con, "UPDATE participants SET $sets WHERE device_id = ?", [...\array_values($fields), $did]);
    if ($st->rowCount() === 0) {
        return ['error' => 'not found', '_status' => 404];
    }
    log_activity('participant.update', $did . ': ' . \implode(',', array_keys($fields)));
    return ['ok' => true];
}

function create_participant(array $body): array
{
    $name = \trim((string) ($body['custom_name'] ?? ''));
    if ($name === '') {
        return ['error' => 'custom_name required', '_status' => 400];
    }
    // Локальний ID для віртуального учасника — не зачіпає рендер index.html.
    $did = 'local/' . \bin2hex(\random_bytes(6));
    $con = db();
    $row = one($con, 'SELECT COALESCE(MAX(position), -1) AS m FROM participants');
    $pos = (int) ($row['m'] ?? -1) + 1;
    q($con,
        'INSERT INTO participants(device_id, original_name, custom_name, skipped, position, user_added) VALUES(?,?,?,0,?,1)',
        [$did, $name, $name, $pos]
    );
    log_activity('participant.create', "$did $name");
    return ['device_id' => $did];
}

function delete_participant(string $did, bool $hard = false): array
{
    $con = db();
    if ($hard) {
        // Видаляємо повністю — безпечно лише для user_added (інакше init_db поверне дефолт).
        $row = one($con, 'SELECT user_added FROM participants WHERE device_id = ?', [$did]);
        if (!$row) {
            return ['error' => 'not found', '_status' => 404];
        }
        if (!$row['user_added']) {
            return ['error' => 'не можна видалити дефолтного учасника', '_status' => 400];
        }
        q($con, 'DELETE FROM participants WHERE device_id = ?', [$did]);
        log_activity('participant.delete', $did);
    } else {
        q($con,
            'UPDATE participants SET custom_name=NULL, avatar=NULL, avatar_mime=NULL, '
            . 'avatar_end=NULL, avatar_end_mime=NULL, updated_at=CURRENT_TIMESTAMP WHERE device_id = ?',
            [$did]
        );
        log_activity('participant.reset', $did);
    }
    return ['ok' => true];
}

/** order = список device_id у бажаному порядку. Перезаписує position (все-або-нічого). */
function reorder($order): array
{
    if (!\is_array($order) || !$order) {
        return ['error' => 'order має бути непорожнім списком device_id', '_status' => 400];
    }
    $con = db();
    $existing = [];
    foreach (all($con, 'SELECT device_id FROM participants') as $r) {
        $existing[$r['device_id']] = true;
    }
    $missing = [];
    foreach ($order as $d) {
        if (!isset($existing[$d])) {
            $missing[] = $d;
        }
    }
    if ($missing) {
        return ['error' => 'невідомі device_id: ' . \implode(', ', \array_slice($missing, 0, 5)), '_status' => 400];
    }
    $con->beginTransaction();
    try {
        foreach (\array_values($order) as $pos => $did) {
            q($con, 'UPDATE participants SET position = ? WHERE device_id = ?', [$pos, $did]);
        }
        $con->commit();
    } catch (\Throwable $e) {
        $con->rollBack();
        throw $e;
    }
    log_activity('participant.reorder', \count($order) . ' шт');
    return ['ok' => true, 'count' => \count($order)];
}
