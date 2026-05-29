<?php
/**
 * CLI-воркер фонової AI-генерації.
 *
 * Замінює daemon-потік Python-версії: сервер детачить окремий процес
 *   php meeteditor/gen_worker.php <generation_id>
 * який робить HTTP-виклик до OpenRouter і оновлює рядок у generations.
 * Працює з тим самим data.db (SQLite — файлове блокування + busy_timeout).
 */
namespace Meet;

require_once __DIR__ . '/generations.php';

$genId = isset($argv[1]) ? (int) $argv[1] : 0;
if ($genId <= 0) {
    \fwrite(\STDERR, "usage: php gen_worker.php <generation_id>\n");
    exit(1);
}
run_generation($genId);
