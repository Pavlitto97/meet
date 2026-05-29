<?php
/**
 * Замінює google CDN-URL у збереженій сторінці Meet на локальні assets/.
 * (Порт rewrite_html.py.)
 *
 *     php rewrite_html.php
 */
$src = '/Users/user/mete/Meet - yrt-kczi-csw.html';
$backup = '/Users/user/mete/Meet - yrt-kczi-csw.html.bak';
if (!is_file($src)) {
    fwrite(STDERR, "Не знайдено: $src\n");
    exit(1);
}
if (!file_exists($backup)) {
    file_put_contents($backup, file_get_contents($src));
}

$html = file_get_contents($src);

// [pattern, callback]
$patterns = [
    // шрифти
    ['#https?://fonts\.gstatic\.com/s/[A-Za-z0-9_/.-]+?\.woff2#', fn($m) => 'assets/fonts/' . substr(strrchr($m[0], '/'), 1)],
    ['#https?://fonts\.gstatic\.com/s/[A-Za-z0-9_/.-]+?\.woff#',  fn($m) => 'assets/fonts/' . substr(strrchr($m[0], '/'), 1)],
    // googlesymbols іконки
    ['#https?://fonts\.gstatic\.com/s/i/short-term/release/googlesymbols/more_horiz/default/24px\.svg#', fn($m) => 'assets/img/more_horiz_24px.svg'],
    ['#https?://fonts\.gstatic\.com/s/i/short-term/release/googlesymbols/remove/default/24px\.svg#',     fn($m) => 'assets/img/remove_24px.svg'],
    // лого Meet з розміром
    ['#https?://www\.gstatic\.com/images/branding/productlogos/meet_2026/v2/web-(\d+)dp/logo_meet_2026_color_1x_web_\1dp\.png#',
        fn($m) => "assets/img/meet_logo/logo_meet_2026_color_1x_web_{$m[1]}dp.png"],
    // www.gstatic.com/meet SVG (хешовані імена)
    ['#https?://www\.gstatic\.com/meet/meetinpip_darkmode_icon_[a-f0-9]+\.svg#', fn($m) => 'assets/img/meetinpip_darkmode_icon.svg'],
    ['#https?://www\.gstatic\.com/meet/no_one_is_sharing_[a-f0-9]+\.svg#',       fn($m) => 'assets/img/no_one_is_sharing.svg'],
    ['#https?://www\.gstatic\.com/meet/pip_on_present_v2_[a-f0-9]+\.svg#',       fn($m) => 'assets/img/pip_on_present_v2.svg'],
    // ssl.gstatic.com (protocol-relative і absolute)
    ['#(?:https?:)?//ssl\.gstatic\.com/docs/documents/share/images/sprite-24\.svg#', fn($m) => 'assets/img/sprite-24.svg'],
    ['#(?:https?:)?//ssl\.gstatic\.com/i18n/flags/48x32/nobevel/[a-f0-9]+/flags\.png#', fn($m) => 'assets/img/flags/flags.png'],
    ['#(?:https?:)?//ssl\.gstatic\.com/ui/v1/icons/common/x_8px\.png#', fn($m) => 'assets/img/x_8px.png'],
];

$total = 0;
foreach ($patterns as [$pat, $repl]) {
    $html = preg_replace_callback($pat, $repl, $html, -1, $n);
    $total += $n;
    printf("%5d  %s\n", $n, substr($pat, 1, 80));
}

file_put_contents($src, $html);
printf("TOTAL replacements: %d\n", $total);
printf("Backup: %s\n", $backup);
