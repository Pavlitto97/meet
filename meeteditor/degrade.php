<?php
/**
 * «Webcam-деградація» аватарок — кілька ПІДХОДІВ на вибір, щоб перемикати й тестити.
 *
 * Ідея: зробити згенероване фото схожим на кадр зі справжньої посередньої веб-камери
 * (мʼякий фокус, сенсорний шум, низькобітрейтні блок-артефакти, кольоровий зсув AWB).
 *
 * Підходи (метод) бувають ДВОХ рівнів:
 *   • server  — піксельна обробка через GD; результат бейкається в байти (JPEG).
 *               Дає СПРАВЖНІ 8×8 DCT-блоки (imagejpeg low-q) — те, чого CSS/SVG не вміють.
 *   • browser — CSS/SVG-фільтр, який накладає сам браузер при рендері (і потрапляє у
 *               скрін, бо Chrome знімає живий /api/render). Байти не міняються — повністю
 *               реверсивно, ідеально для живого підбору сили.
 *
 * Формат параметра `cam`: "<method>:<intensity>", напр. "gd:40", "svg:30", "css:25".
 * intensity — 0..100 (відсотки) або 0..1; усе всередині зводиться до 0..1.
 *
 * ВАЖЛИВО: жоден метод не застосовується, поки `cam` не передано явно — тож дефолтний
 * /api/render лишається байт-у-байт ідентичним (памʼятка dont-touch-render-output).
 */
namespace Meet;

require_once __DIR__ . '/config.php';

/** Перелік підходів для UI лабораторії. */
function degrade_methods(): array
{
    return [
        ['key' => 'none',    'label' => 'Без обробки',        'layer' => 'none',
         'desc' => 'Оригінал як є — байт-у-байт.'],
        ['key' => 'gd',      'label' => 'GD · повна вебка',    'layer' => 'server',
         'desc' => 'Downscale → колір/AWB → blur → шум → low-q JPEG. Найвища достовірність, бейк у пікселі.'],
        ['key' => 'gd-jpeg', 'label' => 'GD · лише кодек',     'layer' => 'server',
         'desc' => 'Тільки downscale + багатопрохідний low-q JPEG — чистий «поганий бітрейт», без шуму/кольору.'],
        ['key' => 'css',     'label' => 'CSS-фільтр',          'layer' => 'browser',
         'desc' => 'blur/contrast/brightness/saturate/sepia/hue — найдешевше, але БЕЗ шуму й блокінгу.'],
    ];
}

/** "gd:40" → ['method'=>'gd', 'intensity'=>0.4]. Невідомий метод → none. */
function parse_cam(?string $cam): array
{
    $method = 'none';
    $I = 0.35; // дефолтна робоча сила, якщо не вказали
    if ($cam !== null && $cam !== '') {
        $parts = \explode(':', $cam, 2);
        $method = \strtolower(\trim($parts[0]));
        if (isset($parts[1]) && \is_numeric($parts[1])) {
            $v = (float) $parts[1];
            $I = $v > 1 ? $v / 100.0 : $v;
        }
    }
    $valid = \array_column(degrade_methods(), 'key');
    if (!\in_array($method, $valid, true)) {
        $method = 'none';
    }
    return ['method' => $method, 'intensity' => \max(0.0, \min(1.0, $I))];
}

function cam_layer(string $method): string
{
    foreach (degrade_methods() as $m) {
        if ($m['key'] === $method) {
            return $m['layer'];
        }
    }
    return 'none';
}

function cam_is_server(string $method): bool { return cam_layer($method) === 'server'; }
function cam_is_browser(string $method): bool { return cam_layer($method) === 'browser'; }

// ─── Серверна обробка (GD) ────────────────────────────────────────────────────

/**
 * Деградує байти зображення під «погану вебку». Повертає JPEG-байти.
 * $variant: 'full' (весь конвеєр) | 'jpeg' (лише downscale + low-q JPEG).
 * $intensity 0..1; 0 або непідтримуваний вхід ⇒ повертає $bytes без змін.
 */
function webcamize(string $bytes, float $intensity, string $variant = 'full'): string
{
    $I = \max(0.0, \min(1.0, $intensity));
    if ($I <= 0.0 || !\function_exists('imagecreatefromstring')) {
        return $bytes;
    }
    $im = @\imagecreatefromstring($bytes); // авто-детект формату за magic bytes
    if ($im === false) {
        return $bytes; // битий / непідтримуваний (AVIF/SVG) — не чіпаємо
    }
    $w = \imagesx($im);
    $h = \imagesy($im);
    if ($w < 2 || $h < 2) {
        \imagedestroy($im);
        return $bytes;
    }

    // (1) DOWNSCALE→UPSCALE — головний «мильний» детайл. До JPEG (після — підсилює сітку блоків).
    $f = 0.65 - 0.30 * $I; // 0.65..0.35
    $sw = \max(1, (int) \round($w * $f));
    $small = \imagescale($im, $sw, -1, IMG_BILINEAR_FIXED);
    if ($small !== false) {
        \imagedestroy($im);
        $im = \imagescale($small, $w, $h, IMG_BILINEAR_FIXED) ?: $small;
        if ($im !== $small) {
            \imagedestroy($small);
        }
    }

    if ($variant === 'full') {
        // (2) КОЛІР / AWB-каст + плоский контраст (до blur/noise).
        //     УВАГА: IMG_FILTER_CONTRAST інвертований — ПОЗИТИВ = МЕНШЕ контрасту (плоско).
        \imagefilter($im, IMG_FILTER_COLORIZE, (int) \round(10 * $I), (int) \round(4 * $I), (int) \round(-9 * $I));
        \imagefilter($im, IMG_FILTER_BRIGHTNESS, (int) \round(-6 * $I));
        \imagefilter($im, IMG_FILTER_CONTRAST, (int) \round(6 * $I));

        // (3) BLUR — мʼякий фокус. GAUSSIAN_BLUR без радіуса (фікс. 3×3): сила через повтор.
        $passes = (int) \round(1 + 2 * $I); // 1..3
        for ($k = 0; $k < $passes; $k++) {
            \imagefilter($im, IMG_FILTER_GAUSSIAN_BLUR);
        }

        // (4) ШУМ — оверлей-шар у half-res (НЕ per-pixel loop на повному зображенні).
        $nw = \max(1, (int) \round($w / 2));
        $nh = \max(1, (int) \round($h / 2));
        $nz = \imagecreatetruecolor($nw, $nh);
        for ($y = 0; $y < $nh; $y++) {
            for ($x = 0; $x < $nw; $x++) {
                $v = \mt_rand(0, 255);
                \imagesetpixel($nz, $x, $y, ($v << 16) | ($v << 8) | $v);
            }
        }
        $nzBig = \imagescale($nz, $w, $h, IMG_BILINEAR_FIXED);
        \imagedestroy($nz);
        if ($nzBig !== false) {
            \imagecopymerge($im, $nzBig, 0, 0, 0, 0, $w, $h, (int) \round(6 + 14 * $I)); // 6..20%
            \imagedestroy($nzBig);
        }
    }

    // (5) БАГАТОПРОХІДНИЙ LOW-Q JPEG — справжні 8×8 DCT-блоки + рінгінг.
    $q1 = (int) \round(48 - 16 * $I); // 48..32
    $q2 = (int) \round(42 - 14 * $I); // 42..28
    $b = _jpeg_bytes($im, $q1);
    \imagedestroy($im);
    $im2 = @\imagecreatefromstring($b);
    if ($im2 === false) {
        return $b;
    }
    $out = _jpeg_bytes($im2, $q2);
    \imagedestroy($im2);
    return $out;
}

function _jpeg_bytes(\GdImage $im, int $q): string
{
    \ob_start();
    \imagejpeg($im, null, \max(1, \min(100, $q)));
    return (string) \ob_get_clean();
}

/** Серверна обробка байтів за методом. Повертає [bytes, mime] (для browser-методів — без змін). */
function degrade_blob(string $bytes, string $mime, string $method, float $intensity): array
{
    if ($intensity <= 0.0 || !cam_is_server($method)) {
        return [$bytes, $mime];
    }
    $variant = $method === 'gd-jpeg' ? 'jpeg' : 'full';
    return [webcamize($bytes, $intensity, $variant), 'image/jpeg'];
}

// ─── Браузерна обробка (CSS) ───────────────────────────────────────────────────

/**
 * Браузерний спек фільтра для browser-методів (зараз — лише css).
 * Повертає ['filter' => '<значення CSS-властивості filter>', 'svg' => ''].
 * Для не-browser методів — порожньо.
 */
function cam_spec(string $method, float $intensity): array
{
    $I = \max(0.0, \min(1.0, $intensity));
    if ($I <= 0.0 || !cam_is_browser($method)) {
        return ['filter' => '', 'svg' => ''];
    }

    // css: чистий CSS-фільтр (без шуму й блокінгу — для них є server-методи gd/gd-jpeg).
    $blur = \sprintf('%.2f', 0.3 + 1.0 * $I);   // px
    $con  = \sprintf('%.3f', 1 - 0.15 * $I);
    $bri  = \sprintf('%.3f', 1 - 0.06 * $I);
    $sat  = \sprintf('%.3f', 1 - 0.15 * $I);
    $sep  = \sprintf('%.3f', 0.10 * $I);
    $hue  = \sprintf('%.1f', -6 * $I);
    return [
        'filter' => "blur({$blur}px) contrast({$con}) brightness({$bri}) saturate({$sat}) sepia({$sep}) hue-rotate({$hue}deg)",
        'svg'    => '',
    ];
}

/** Розмітка для інʼєкції у <head> рендера для browser-методів (svg-def + <style>). Порожньо інакше. */
function cam_head_markup(string $method, float $intensity): string
{
    $spec = cam_spec($method, $intensity);
    if ($spec['filter'] === '') {
        return '';
    }
    return $spec['svg']
        . '<style>.oZRSLe img.m0DVAf[src^="data:"]{filter:' . $spec['filter'] . '!important;}</style>';
}
