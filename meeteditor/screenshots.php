<?php
/**
 * Скріни рендеру Meet через headless Chrome + історія знімків у БД.
 *
 * Сервер шелл-аутить уже встановлений Chrome у headless проти ЖИВОГО
 * http://127.0.0.1:PORT/api/render?which=... (а не file://, бо рендер має
 * <base href="/"> — на file:// шрифти/іконки не зарезолвились би).
 *
 * Чому proc_open + опитування файлу: сучасний Chrome пише --screenshot на диск,
 * але САМ НЕ ВИХОДИТЬ. Тож запускаємо, чекаємо поки PNG зʼявиться й стабілізується
 * за розміром, потім прибиваємо процес.
 *
 * Потрібен PHP_CLI_SERVER_WORKERS>1 (виставляє server.php), щоб поки цей запит
 * тримається, інший воркер віддавав Chrome /api/render та assets.
 */
namespace Meet;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/state.php';

const CHROME_APPS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const CHROME_CMDS = [
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    'chrome', 'microsoft-edge', 'brave-browser',
];

const CAPTURE_TIMEOUT = 30.0;
const MIN_W = 320;
const MIN_H = 240;
const MAX_W = 3840;
const MAX_H = 2160;

function which_bin(string $name): ?string
{
    foreach (\explode(PATH_SEPARATOR, (string) \getenv('PATH')) as $dir) {
        if ($dir === '') {
            continue;
        }
        $f = \rtrim($dir, '/') . '/' . $name;
        if (\is_file($f) && \is_executable($f)) {
            return $f;
        }
    }
    return null;
}

/** Шлях до бінарника Chrome/Chromium або null. */
function find_chrome(): ?string
{
    $env = \getenv('CHROME_BIN');
    if ($env && \is_file($env) && \is_executable($env)) {
        return $env;
    }
    foreach (CHROME_APPS as $p) {
        if (\is_file($p) && \is_executable($p)) {
            return $p;
        }
    }
    foreach (CHROME_CMDS as $name) {
        $found = which_bin($name);
        if ($found) {
            return $found;
        }
    }
    return null;
}

function chrome_available(): bool
{
    return find_chrome() !== null;
}

function rrmdir(string $dir): void
{
    if (!\is_dir($dir)) {
        return;
    }
    $it = new \RecursiveIteratorIterator(
        new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
        \RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($it as $f) {
        $f->isDir() ? @\rmdir($f->getPathname()) : @\unlink($f->getPathname());
    }
    @\rmdir($dir);
}

function kill_proc($proc): void
{
    $st = \proc_get_status($proc);
    if ($st['running']) {
        \proc_terminate($proc, 15); // SIGTERM
        for ($i = 0; $i < 50; $i++) {
            if (!\proc_get_status($proc)['running']) {
                break;
            }
            \usleep(100000);
        }
        if (\proc_get_status($proc)['running']) {
            \proc_terminate($proc, 9); // SIGKILL
        }
    }
    \proc_close($proc);
}

/** Робить один скрін url у вікні width×height. Повертає [png|null, errTail]. */
function run_chrome(string $chrome, string $url, int $width, int $height): array
{
    $tmp = \sys_get_temp_dir() . '/meetshot-' . \bin2hex(\random_bytes(6));
    @\mkdir($tmp, 0700, true);
    $out = $tmp . '/shot.png';
    $errlog = $tmp . '/chrome.err';
    $cmd = [
        $chrome,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--no-first-run',
        '--no-default-browser-check',
        '--user-data-dir=' . $tmp . '/profile',
        '--window-size=' . $width . ',' . $height,
        // даємо ресурсам (шрифти/іконки через локальний HTTP) догрузитись; на idle
        // віртуальний час перемотується миттєво.
        '--virtual-time-budget=6000',
        '--run-all-compositor-stages-before-draw',
        '--screenshot=' . $out,
        $url,
    ];
    $descriptors = [
        0 => ['file', '/dev/null', 'r'],
        1 => ['file', '/dev/null', 'w'],
        2 => ['file', $errlog, 'w'],
    ];
    $pipes = [];
    $proc = \proc_open($cmd, $descriptors, $pipes);
    if (!\is_resource($proc)) {
        rrmdir($tmp);
        return [null, 'не вдалось запустити Chrome'];
    }

    $t0 = \microtime(true);
    $png = null;
    $last = -1;
    $stable = 0;
    try {
        while (\microtime(true) - $t0 < CAPTURE_TIMEOUT) {
            $running = \proc_get_status($proc)['running'];
            \clearstatcache(true, $out);
            $exists = \is_file($out);
            if (!$running && !$exists) {
                break; // Chrome помер, файлу нема — помилка
            }
            if ($exists) {
                $sz = (int) \filesize($out);
                if ($sz > 0 && $sz === $last) {
                    $stable++;
                    if ($stable >= 2) { // ~0.2с без змін → дописано
                        \usleep(50000);
                        $png = \file_get_contents($out);
                        break;
                    }
                } else {
                    $stable = 0;
                }
                $last = $sz;
            }
            \usleep(100000);
        }
    } finally {
        kill_proc($proc);
    }

    if ($png !== false && $png !== null && $png !== '') {
        rrmdir($tmp);
        return [$png, ''];
    }
    $tail = '';
    if (\is_file($errlog)) {
        $tail = \trim((string) \file_get_contents($errlog));
        $tail = \substr($tail, -400);
    }
    rrmdir($tmp);
    return [null, $tail];
}

/** Робить скрін рендеру (start|end) і складає у таблицю screenshots. */
function capture(string $which = 'start', $width = 1280, $height = 720, ?string $label = null, ?string $cam = null): array
{
    $which = $which === 'end' ? 'end' : 'start';
    if (!\is_numeric($width) || !\is_numeric($height)) {
        return ['error' => 'width/height мають бути числами', '_status' => 400];
    }
    $width = \max(MIN_W, \min((int) $width, MAX_W));
    $height = \max(MIN_H, \min((int) $height, MAX_H));

    $chrome = find_chrome();
    if (!$chrome) {
        return ['error' => 'Google Chrome не знайдено. Встанови Chrome або задай змінну середовища CHROME_BIN.', '_status' => 503];
    }
    $port = port();
    if (!$port) {
        return ['error' => 'порт сервера невідомий — не можу відкрити /api/render', '_status' => 500];
    }

    // cam=<метод>:<сила> — webcam-деградація. Явний аргумент має перевагу; інакше
    // беремо збережений дефолт (cam_method/cam_intensity) з налаштувань.
    if ($cam === null || $cam === '') {
        $m = get_setting('cam_method');
        if ($m !== '' && $m !== 'none') {
            $i = get_setting('cam_intensity');
            $cam = $m . ':' . ($i !== '' ? $i : '35');
        }
    }

    // fit=ШИРИНАxВИСОТА — рендер масштабує контейнер Meet під розмір вікна скріна,
    // щоб не було білих полос (сторінка має жорстко зашитий рідний розмір).
    $url = 'http://' . HOST . ':' . $port . '/api/render?which=' . $which
        . '&fit=' . $width . 'x' . $height;
    if ($cam !== null && $cam !== '' && $cam !== 'none') {
        $url .= '&cam=' . \rawurlencode($cam);
    }
    [$png, $err] = run_chrome($chrome, $url, $width, $height);
    if (!$png) {
        $msg = 'Chrome не зробив скрін за відведений час';
        if ($err) {
            $msg .= ": $err";
        }
        return ['error' => $msg, '_status' => 500];
    }

    $code = get_setting('meeting_code');
    $lbl = \trim((string) ($label ?? '')) !== '' ? \trim((string) $label) : null;
    $con = db();
    q($con,
        'INSERT INTO screenshots(which, image, image_mime, width, height, meeting_code, label, size_bytes) VALUES(?,?,?,?,?,?,?,?)',
        [$which, $png, 'image/png', $width, $height, $code, $lbl, \strlen($png)]
    );
    $sid = (int) $con->lastInsertId();
    log_activity('screenshot.capture', "#$sid $which {$width}x{$height} " . \strlen($png) . 'B');
    return ['id' => $sid, 'which' => $which, 'width' => $width, 'height' => $height, 'size_bytes' => \strlen($png)];
}

function list_screenshots(?string $which = null): array
{
    $sql =
        'SELECT id, which, image_mime, width, height, meeting_code, label, size_bytes, '
        . 'created_at, (image IS NOT NULL) AS has_image FROM screenshots WHERE 1=1';
    $args = [];
    if ($which === 'start' || $which === 'end') {
        $sql .= ' AND which = ?';
        $args[] = $which;
    }
    $sql .= ' ORDER BY id DESC LIMIT 200';
    return all(db(), $sql, $args);
}

/** [image, mime] або null. */
function screenshot_image(int $sid): ?array
{
    $row = one(db(), 'SELECT image, image_mime FROM screenshots WHERE id = ?', [$sid]);
    if (!$row || ($row['image'] ?? null) === null) {
        return null;
    }
    return [$row['image'], $row['image_mime']];
}

function delete_screenshot(int $sid): array
{
    q(db(), 'DELETE FROM screenshots WHERE id = ?', [$sid]);
    log_activity('screenshot.delete', "#$sid");
    return ['ok' => true];
}

/** scope: 'start' | 'end' | 'all'. */
function bulk_delete_screenshots(string $scope): array
{
    if ($scope === 'all') {
        $sql = 'DELETE FROM screenshots';
        $args = [];
    } elseif ($scope === 'start' || $scope === 'end') {
        $sql = 'DELETE FROM screenshots WHERE which = ?';
        $args = [$scope];
    } else {
        return ['error' => 'scope має бути start|end|all', '_status' => 400];
    }
    $st = q(db(), $sql, $args);
    $n = $st->rowCount();
    log_activity('screenshot.bulk_delete', "$scope: $n");
    return ['ok' => true, 'deleted' => $n];
}
