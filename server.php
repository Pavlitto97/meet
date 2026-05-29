<?php
/**
 * Локальний сервер для редактора Meet HTML — точка входу (PHP-версія).
 *
 *     php server.php                 # порт 8000 (або змінна PORT)
 *     php server.php --port 8123
 *
 * Відкрити:
 *     http://localhost:8000/editor.html   ← редактор
 *     http://localhost:8000/admin.html    ← адмін-панель
 *
 * Запускає вбудований веб-сервер PHP із front controller-ом router.php.
 * PHP_CLI_SERVER_WORKERS>1 — щоб скріни працювали (поки запит /api/screenshots
 * тримається, інший воркер віддає Chrome /api/render + assets).
 *
 * Без зовнішніх залежностей — лише стандартний PHP (pdo_sqlite, curl).
 */
namespace Meet;

if (\PHP_SAPI !== 'cli') {
    \fwrite(\STDERR, "server.php запускається з CLI: php server.php [--port N]\n");
    exit(1);
}

require_once __DIR__ . '/meeteditor/bootstrap.php';

// ─── Розбір порту ───────────────────────────────────────────────────────────────
function parse_port(array $argv): int
{
    $n = \count($argv);
    for ($i = 1; $i < $n; $i++) {
        $a = $argv[$i];
        if ($a === '--port' || $a === '-p') {
            if ($i + 1 < $n) {
                return (int) $argv[$i + 1];
            }
        } elseif (\str_starts_with($a, '--port=')) {
            return (int) \substr($a, 7);
        }
    }
    return default_port();
}

$port = parse_port($argv);

// ─── Ініціалізація БД (один раз при старті) ──────────────────────────────────────
init_db();

$started = \time();
echo "Serving on http://" . HOST . ":$port  (editor: /editor.html · admin: /admin.html)\n";

// ─── Запуск вбудованого веб-сервера ──────────────────────────────────────────────
$env = \getenv();
$env['MEET_PORT'] = (string) $port;
$env['MEET_STARTED'] = (string) $started;
$env['PHP_CLI_SERVER_WORKERS'] = $env['PHP_CLI_SERVER_WORKERS'] ?? '4';

$args = ['-S', HOST . ":$port", '-t', ROOT, __DIR__ . '/router.php'];

if (\function_exists('pcntl_exec')) {
    // Заміщаємо процес — Ctrl-C іде прямо у php -S.
    \pcntl_exec(\PHP_BINARY, $args, $env);
    \fwrite(\STDERR, "pcntl_exec не вдався\n");
    exit(1);
}

// Фолбек без pcntl: env-префікс + passthru.
$prefix = '';
foreach (['MEET_PORT', 'MEET_STARTED', 'PHP_CLI_SERVER_WORKERS'] as $k) {
    $prefix .= $k . '=' . \escapeshellarg($env[$k]) . ' ';
}
$cmd = $prefix . \escapeshellarg(\PHP_BINARY) . ' '
    . \implode(' ', \array_map('escapeshellarg', $args));
\passthru($cmd, $code);
exit($code);
