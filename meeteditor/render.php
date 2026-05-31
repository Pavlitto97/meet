<?php
/**
 * Генерація Meet HTML із застосованими правками (аватарки, імена, час, код, emoji).
 *
 * Текстова заміна по сирому HTML (байтами) — НЕ DOM-парсинг: DOMParser перепаковує
 * атрибути і втрачає особливості Meet markup. index.html недоторканий — усе в пам'яті.
 */
namespace Meet;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/settings.php';

function render_meet(string $which = 'start', ?string $fit = null): string
{
    if ($which !== 'start' && $which !== 'end') {
        $which = 'start';
    }
    $html = (string) \file_get_contents(MEET_HTML);

    // Позиції всіх data-participant-id у файлі (байтові офсети).
    \preg_match_all('#data-participant-id="([^"]+)"#', $html, $pm, PREG_OFFSET_CAPTURE);
    $occ = [];
    foreach ($pm[0] as $i => $full) {
        $occ[] = [
            'start' => $full[1],
            'end'   => $full[1] + \strlen($full[0]),
            'pid'   => $pm[1][$i][0],
        ];
    }

    $con = db();
    $rows = [];
    foreach (all($con, 'SELECT device_id, original_name, custom_name, avatar, avatar_mime, avatar_end, avatar_end_mime FROM participants') as $r) {
        $rows[$r['device_id']] = $r;
    }

    $edits = []; // [start, end, replacement]
    $n = \count($occ);
    for ($i = 0; $i < $n; $i++) {
        $pid = $occ[$i]['pid'];
        if (!isset($rows[$pid])) {
            continue;
        }
        $row = $rows[$pid];
        $posEnd = $occ[$i]['end'];
        $bound = $i + 1 < $n ? $occ[$i + 1]['start'] : \strlen($html);
        $tile = \substr($html, $posEnd, $bound - $posEnd);

        // Аватарка — за which, з фолбеком на avatar якщо end ще не задано.
        if ($which === 'end' && ($row['avatar_end'] ?? null) !== null && $row['avatar_end'] !== '') {
            $blob = $row['avatar_end'];
            $mime = $row['avatar_end_mime'];
        } else {
            $blob = $row['avatar'] ?? null;
            $mime = $row['avatar_mime'] ?? null;
        }
        if ($blob !== null && $blob !== '' && !empty($mime)) {
            $dataUrl = 'data:' . $mime . ';base64,' . \base64_encode($blob);
            \preg_match_all('#<img\b[^>]*?\ssrc="([^"]*)"#', $tile, $im, PREG_OFFSET_CAPTURE);
            foreach ($im[1] as $cap) {
                $valStart = $posEnd + $cap[1];
                $valEnd = $valStart + \strlen($cap[0]);
                $edits[] = [$valStart, $valEnd, $dataUrl];
            }
        }
    }

    // Застосовуємо за спаданням позиції, щоб офсети не зсувались.
    \usort($edits, fn($a, $b) => $b[0] <=> $a[0]);
    foreach ($edits as [$start, $end, $repl]) {
        $html = \substr($html, 0, $start) . $repl . \substr($html, $end);
    }

    // ─ імена: глобальна заміна (людина зʼявляється у плитці, банері й листі учасників) ─
    $namePairs = all($con, "SELECT original_name, custom_name FROM participants WHERE custom_name IS NOT NULL AND custom_name != ''");
    // Довші оригінали — перші, щоб короткі підрядки не зіпсували довші.
    \usort($namePairs, fn($a, $b) => \mb_strlen($b['original_name']) <=> \mb_strlen($a['original_name']));
    foreach ($namePairs as $r) {
        if ($r['custom_name'] !== $r['original_name']) {
            $html = \str_replace($r['original_name'], $r['custom_name'], $html);
        }
    }

    // ─ глобальні налаштування (час, період, код зустрічі) ─
    $s = get_settings();
    $newCode = \trim(($s['meeting_code'] ?? '') !== '' ? $s['meeting_code'] : ORIGINAL_MEETING_CODE);
    if ($newCode !== '' && $newCode !== ORIGINAL_MEETING_CODE) {
        $html = \str_replace(ORIGINAL_MEETING_CODE, $newCode, $html);
    }

    $timeKey = $which === 'end' ? 'end_time' : 'start_time';
    $periodKey = $which === 'end' ? 'end_period' : 'start_period';
    $newTime = \trim(($s[$timeKey] ?? '') !== '' ? $s[$timeKey] : ORIGINAL_TIME);
    if ($newTime !== '' && $newTime !== ORIGINAL_TIME) {
        $html = \preg_replace_callback(
            '#(<span jsname="W5i7Bf">)' . \preg_quote(ORIGINAL_TIME, '#') . '(</span>)#',
            fn($m) => $m[1] . $newTime . $m[2],
            $html,
            1
        );
    }
    $newPeriod = \trim(($s[$periodKey] ?? '') !== '' ? $s[$periodKey] : ORIGINAL_PERIOD);
    if ($newPeriod !== '' && $newPeriod !== ORIGINAL_PERIOD) {
        $html = \preg_replace_callback(
            '#(<span jsname="d1rraf"[^>]*>)' . \preg_quote(ORIGINAL_PERIOD, '#') . '(</span>)#',
            fn($m) => $m[1] . $newPeriod . $m[2],
            $html,
            1
        );
    }

    // Emoji-кнопки реакцій: cleanup замінив усі fonts.gstatic.com PNG на
    // placeholder.svg → видно ряд однакових сірих гуртків. Підміняємо src за data-emoji.
    $emojiMap = emoji_codepoints();
    $html = \preg_replace_callback(
        '#(?P<pre><img\b[^>]*?\bdata-emoji="(?P<emoji>[^"]+)"[^>]*?\s)src="[^"]*"(?P<post>[^>]*?>)#',
        function ($m) use ($emojiMap) {
            $code = $emojiMap[$m['emoji']] ?? null;
            if (!$code) {
                return $m[0];
            }
            return $m['pre'] . 'src="assets/img/emoji/' . $code . '.png"' . $m['post'];
        },
        $html
    );

    // <base href="/"> щоб assets/... резолвились від кореня (рендер віддається через /api/render).
    // Override-стилі: розтягуємо кастомне data:base64-фото на весь розмір плитки.
    $headInject =
        '<base href="/">'
        . '<style>'
        . '.oZRSLe:has(img.m0DVAf[src^="data:"]){position:relative!important;}'
        . '.oZRSLe img.m0DVAf[src^="data:"]{'
        . 'position:absolute!important;inset:0!important;'
        . 'width:100%!important;height:100%!important;'
        . 'object-fit:cover!important;border-radius:inherit!important;'
        . 'display:block!important;clip-path:none!important;z-index:5!important;}'
        . '.oZRSLe:has(img.m0DVAf[src^="data:"]) img.SOQwsf{display:none!important;}'
        . '</style>';

    // Скрін-режим (?fit=ШИРИНАxВИСОТА): уся сторінка Meet живе в контейнері
    // #yDmH0d з ЖОРСТКО зашитим розміром (напр. 1728×996 — логічний розмір вікна
    // на момент збереження). Якщо headless Chrome знімає у більшому вікні (Full HD),
    // решта — білий фон <body>, який «вилазить» праворуч/знизу. Тут масштабуємо
    // #yDmH0d так, щоб він точно заповнив запитане вікно (без білих полос).
    // Робиться ЛИШЕ коли явно передано fit — дефолтний /api/render лишається
    // байт-у-байт ідентичним.
    if ($fit !== null && \preg_match('#^(\d+)x(\d+)$#', $fit, $fm)) {
        $fitW = (int) $fm[1];
        $fitH = (int) $fm[2];
        // Рідний розмір контейнера зі збереженого HTML (фолбек — 1728×996).
        $natW = 1728;
        $natH = 996;
        if (\preg_match('#id="yDmH0d"[^>]*style="[^"]*\bwidth:\s*(\d+)px;\s*height:\s*(\d+)px#', $html, $nm)) {
            $natW = (int) $nm[1];
            $natH = (int) $nm[2];
        }
        if ($fitW > 0 && $fitH > 0 && $natW > 0 && $natH > 0) {
            $sx = $fitW / $natW;
            $sy = $fitH / $natH;
            $headInject .= '<style>'
                . 'html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important;}'
                . '#yDmH0d{transform:scale(' . \sprintf('%.6f', $sx) . ',' . \sprintf('%.6f', $sy) . ')!important;'
                . 'transform-origin:top left!important;}'
                . '</style>';
        }
    }

    $needle = '<head>';
    $p = \strpos($html, $needle);
    if ($p !== false) {
        $html = \substr($html, 0, $p) . $needle . $headInject . \substr($html, $p + \strlen($needle));
    }
    return $html;
}
