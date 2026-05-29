<?php
/**
 * Front controller для вбудованого веб-сервера PHP (`php -S … router.php`).
 *
 * Викликається на КОЖЕН запит. API-маршрути обробляє dispatch(); решта (GET) —
 * статика з кореня проєкту через serve_file(). БД ініціалізує server.php при
 * старті, тож тут лише диспетчеризація.
 */
namespace Meet;

require_once __DIR__ . '/meeteditor/bootstrap.php';

$req = request_from_globals();
try {
    $resp = dispatch($req);
} catch (\Throwable $e) {
    \error_log((string) $e);
    $resp = Response::json(['error' => $e->getMessage()], 500);
}
send($resp);
