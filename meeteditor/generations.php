<?php
/** Черга AI-генерацій аватарок: створення, фонове виконання, апрув, регенерація. */
namespace Meet;

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/openrouter.php';

/** Виконується у фоновому процесі (gen_worker.php). Оновлює рядок generations. */
function run_generation(int $genId): void
{
    try {
        $con = db();
        $row = one($con, 'SELECT id, participant_id, prompt, model, provider, service_tier, input_image, input_mime FROM generations WHERE id = ?', [$genId]);
        if (!$row) {
            return;
        }
        $apiKey = get_setting('openrouter_api_key');
        if ($apiKey === '') {
            throw new \RuntimeException('OpenRouter API key не задано. Введи його у налаштуваннях.');
        }
        // Беремо заморожений знімок вхідного фото (input_image). Старі рядки без
        // знімка — фолбек на поточний аватар учасника.
        if (($row['input_image'] ?? null) !== null && !empty($row['input_mime'])) {
            $inputUrl = blob_to_data_url($row['input_mime'], $row['input_image']);
        } else {
            $inputUrl = $row['participant_id'] ? avatar_data_url($row['participant_id']) : null;
        }
        // Gemini деколи відповідає 200 OK без image — це транзієнтно, повторюємо до 3 разів.
        $maxAttempts = 3;
        $lastErr = null;
        $mime = null;
        $blob = null;
        $usage = [];
        for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
            try {
                $resp = call_image($apiKey, $row['model'], $row['provider'], $row['service_tier'], $row['prompt'], $inputUrl);
                [$mime, $blob] = extract_image($resp);
                $usage = $resp['usage'] ?? [];
                $lastErr = null;
                break;
            } catch (\RuntimeException $e) {
                $lastErr = $e;
                // Ретраїмо лише empty-image випадки. HTTP-помилки самі не виправляться.
                if (\strpos($e->getMessage(), 'image_url') === false) {
                    throw $e;
                }
                \fwrite(\STDERR, "[gen #$genId] empty image, retry " . ($attempt + 1) . "/$maxAttempts\n");
            }
        }
        if ($lastErr && $blob === null) {
            throw $lastErr;
        }
        $cost = $usage['cost'] ?? null;
        $ptok = $usage['prompt_tokens'] ?? null;
        $otok = $usage['completion_tokens'] ?? ($usage['output_tokens'] ?? null);
        $con = db();
        q($con,
            "UPDATE generations SET status='done', image=?, image_mime=?, cost_usd=?, "
            . "prompt_tokens=?, output_tokens=?, finished_at=CURRENT_TIMESTAMP WHERE id=?",
            [$blob, $mime, $cost, $ptok, $otok, $genId]
        );
        log_activity('generation.done', "#$genId cost=" . ($cost ?? ''));
    } catch (\Throwable $e) {
        $msg = \trim((new \ReflectionClass($e))->getShortName() . ': ' . $e->getMessage());
        try {
            $con = db();
            q($con, "UPDATE generations SET status='error', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?", [$msg, $genId]);
        } catch (\Throwable $x) {
            // ignore
        }
        log_activity('generation.error', "#$genId " . \substr($msg, 0, 120));
    }
}

/** Запускає фоновий процес-воркер для генерації (детачнутий, як daemon-потік у Python). */
function spawn_generation(int $genId): void
{
    $cmd = \escapeshellarg(PHP_BINARY) . ' ' . \escapeshellarg(__DIR__ . '/gen_worker.php')
        . ' ' . (int) $genId . ' > /dev/null 2>&1 &';
    \exec($cmd);
}

/** Ставить нову генерацію у чергу й запускає фоновий процес. Повертає {id} або {error}. */
function create_generation(array $body): array
{
    $pid = $body['participant_id'] ?? null;
    $prompt = \trim((string) ($body['prompt'] ?? ''));
    if ($prompt === '') {
        $prompt = \is_file(PROMPT_FILE) ? \trim((string) \file_get_contents(PROMPT_FILE)) : '';
    }
    if ($prompt === '') {
        return ['error' => 'prompt порожній', '_status' => 400];
    }
    $s = get_settings(true);
    if (empty($s['openrouter_api_key'])) {
        return ['error' => 'OpenRouter API key не задано', '_status' => 400];
    }
    $model = ($body['model'] ?? '') ?: ($s['gen_model'] ?? '') ?: DEFAULT_GEN_MODEL;
    $provider = ($body['provider'] ?? '') ?: ($s['gen_provider'] ?? '') ?: DEFAULT_GEN_PROVIDER;
    $tier = ($body['service_tier'] ?? '') ?: ($s['gen_tier'] ?? '') ?: DEFAULT_GEN_TIER;
    // Заморожуємо вхідне (оригінальне) фото на момент постановки в чергу — щоб
    // показувати «оригінал → результат» і перегенерувати з того самого оригіналу.
    $inBlob = null;
    $inMime = null;
    if ($pid) {
        $inputUrl = avatar_data_url($pid);
        if ($inputUrl) {
            try {
                [$inMime, $inBlob] = parse_data_url($inputUrl);
            } catch (\Throwable $e) {
                $inBlob = null;
                $inMime = null;
            }
        }
    }
    $con = db();
    q($con,
        'INSERT INTO generations(participant_id, prompt, model, provider, service_tier, input_image, input_mime) VALUES(?,?,?,?,?,?,?)',
        [$pid, $prompt, $model, $provider, $tier, $inBlob, $inMime]
    );
    $genId = (int) $con->lastInsertId();
    log_activity('generation.start', "#$genId pid=$pid");
    spawn_generation($genId);
    return ['id' => $genId];
}

function list_generations(?string $participant = null, ?string $status = null): array
{
    $sql =
        "SELECT g.id, g.participant_id, g.prompt, g.model, g.provider, g.service_tier, "
        . "g.status, g.error, g.image IS NOT NULL AS has_image, g.image_mime, "
        . "g.input_image IS NOT NULL AS has_input, "
        . "g.cost_usd, g.prompt_tokens, g.output_tokens, g.created_at, g.finished_at, "
        . "COALESCE(p.custom_name, p.original_name) AS participant_name "
        . "FROM generations g LEFT JOIN participants p ON p.device_id = g.participant_id WHERE 1=1";
    $args = [];
    if ($participant) {
        $sql .= ' AND g.participant_id = ?';
        $args[] = $participant;
    }
    if ($status) {
        $sql .= ' AND g.status = ?';
        $args[] = $status;
    }
    $sql .= ' ORDER BY g.participant_id, g.id DESC LIMIT 200';
    return all(db(), $sql, $args);
}

/** [image, mime] або null. */
function generation_image(int $gid): ?array
{
    $row = one(db(), 'SELECT image, image_mime FROM generations WHERE id = ?', [$gid]);
    if (!$row || ($row['image'] ?? null) === null) {
        return null;
    }
    return [$row['image'], $row['image_mime']];
}

/** Вхідне (оригінальне) зображення генерації [blob, mime] або null. */
function generation_input(int $gid): ?array
{
    $row = one(db(), 'SELECT input_image, input_mime FROM generations WHERE id = ?', [$gid]);
    if (!$row || ($row['input_image'] ?? null) === null) {
        return null;
    }
    return [$row['input_image'], $row['input_mime'] ?: 'image/jpeg'];
}

/** Приймає готову генерацію як аватар учасника (which = start|end), видаляє рядок генерації. */
function approve_generation(int $gid, string $which = 'start'): array
{
    $blobCol = $which === 'end' ? 'avatar_end' : 'avatar';
    $mimeCol = $which === 'end' ? 'avatar_end_mime' : 'avatar_mime';
    $con = db();
    $con->beginTransaction();
    try {
        $row = one($con, 'SELECT participant_id, image, image_mime, status FROM generations WHERE id = ?', [$gid]);
        if (!$row) {
            $con->rollBack();
            return ['error' => 'not found', '_status' => 404];
        }
        if ($row['status'] !== 'done' || ($row['image'] ?? null) === null) {
            $con->rollBack();
            return ['error' => 'генерація ще не готова', '_status' => 400];
        }
        $pid = $row['participant_id'];
        if (!$pid) {
            $con->rollBack();
            return ['error' => 'генерація не привʼязана до учасника', '_status' => 400];
        }
        $st = q($con,
            "UPDATE participants SET $blobCol=?, $mimeCol=?, updated_at=CURRENT_TIMESTAMP WHERE device_id=?",
            [$row['image'], $row['image_mime'], $pid]
        );
        if ($st->rowCount() === 0) {
            $con->rollBack();
            return ['error' => 'учасника не знайдено', '_status' => 404];
        }
        q($con, 'DELETE FROM generations WHERE id = ?', [$gid]);
        $con->commit();
    } catch (\Throwable $e) {
        $con->rollBack();
        throw $e;
    }
    log_activity('generation.approve', "#$gid → $pid ($which)");
    return ['ok' => true];
}

/** Створює нову генерацію з тими ж параметрами. */
function regenerate(int $gid): array
{
    $con = db();
    $row = one($con, 'SELECT participant_id, prompt, model, provider, service_tier, input_image, input_mime FROM generations WHERE id = ?', [$gid]);
    if (!$row) {
        return ['error' => 'not found', '_status' => 404];
    }
    // Переносимо той самий заморожений оригінал → перегенерація на його основі.
    q($con,
        'INSERT INTO generations(participant_id, prompt, model, provider, service_tier, input_image, input_mime) VALUES(?,?,?,?,?,?,?)',
        [$row['participant_id'], $row['prompt'], $row['model'], $row['provider'], $row['service_tier'], $row['input_image'], $row['input_mime']]
    );
    $newId = (int) $con->lastInsertId();
    log_activity('generation.regenerate', "#$gid → #$newId");
    spawn_generation($newId);
    return ['id' => $newId];
}

function delete_generation(int $gid): array
{
    q(db(), 'DELETE FROM generations WHERE id = ?', [$gid]);
    return ['ok' => true];
}

/** scope: 'error' | 'done' | 'pending' | 'all'. */
function bulk_delete_generations(string $scope): array
{
    if ($scope === 'all') {
        $sql = 'DELETE FROM generations';
        $args = [];
    } elseif (\in_array($scope, ['error', 'done', 'pending'], true)) {
        $sql = 'DELETE FROM generations WHERE status = ?';
        $args = [$scope];
    } else {
        return ['error' => 'scope має бути error|done|pending|all', '_status' => 400];
    }
    $st = q(db(), $sql, $args);
    $n = $st->rowCount();
    log_activity('generation.bulk_delete', "$scope: $n");
    return ['ok' => true, 'deleted' => $n];
}
