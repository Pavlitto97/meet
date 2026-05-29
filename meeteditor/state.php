<?php
/**
 * Рантайм-стан процесу: порт і момент старту. Береться зі змінних середовища,
 * які виставляє server.php перед запуском вбудованого веб-сервера (вони
 * успадковуються всіма воркерами `php -S`).
 */
namespace Meet;

/** Порт, на якому реально запущено сервер (або null, якщо невідомий). */
function port(): ?int
{
    $p = \getenv('MEET_PORT');
    return ($p !== false && $p !== '') ? (int) $p : null;
}

/** Unix-час старту сервера (для uptime). Фолбек — час поточного запиту. */
function started_at(): float
{
    $s = \getenv('MEET_STARTED');
    if ($s !== false && $s !== '') {
        return (float) $s;
    }
    return (float) ($_SERVER['REQUEST_TIME_FLOAT'] ?? \microtime(true));
}
