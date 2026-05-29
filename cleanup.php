<?php
/**
 * Прибирає JS, Google-preconnect-и/посилання зі збереженої сторінки Meet і
 * вказує биті локальні посилання на один placeholder. (Порт cleanup.py.)
 *
 *     php cleanup.php
 */
$src = '/Users/user/mete/Meet - yrt-kczi-csw.html';
if (!is_file($src)) {
    fwrite(STDERR, "Не знайдено: $src\n");
    exit(1);
}
$html = file_get_contents($src);
$origLen = strlen($html);

// 1) Прибрати всі <script>...</script>
$html = preg_replace('#<script\b[^>]*>.*?</script\s*>#is', '', $html, -1, $nScript);
$html = preg_replace('#<script\b[^>]*/>#i', '', $html, -1, $nScript2);
// 2) Прибрати <noscript>...</noscript>
$html = preg_replace('#<noscript\b[^>]*>.*?</noscript\s*>#is', '', $html, -1, $nNoscript);
// 3) Inline-обробники on*="..." / on*='...'
$html = preg_replace('#\s+on[a-z]+\s*=\s*"[^"]*"#i', '', $html, -1, $nOn);
$html = preg_replace("#\s+on[a-z]+\s*=\s*'[^']*'#i", '', $html, -1, $nOn2);
// 4) <link rel="preconnect|dns-prefetch"> на Google-домени
$html = preg_replace(
    '#<link\b[^>]*\brel\s*=\s*"(?:preconnect|dns-prefetch)"[^>]*\bhref\s*=\s*"https?://[^"]*(?:google|gstatic)[^"]*"[^>]*>#i',
    '', $html, -1, $nPre
);
// 5) Биті ./Meet - yrt-kczi-csw_files/... → placeholder
$html = preg_replace('#\./Meet - yrt-kczi-csw_files/[^"\'<>)\s]+#', 'assets/img/placeholder.svg', $html, -1, $nLocal);
// 6) Google → App, google → app
$html = preg_replace('#Google#', 'App', $html, -1, $nG);
$html = preg_replace('#google#', 'app', $html, -1, $ng);
// 7) Прибрати зайві порожні рядки
$html = preg_replace('#\n{3,}#', "\n\n", $html);

file_put_contents($src, $html);

printf("scripts removed:        %d\n", $nScript + $nScript2);
printf("noscript removed:       %d\n", $nNoscript);
printf("inline handlers:        %d\n", $nOn + $nOn2);
printf("google preconnects:     %d\n", $nPre);
printf("local img refs -> ph:   %d\n", $nLocal);
printf("Google -> App:          %d\n", $nG);
printf("google -> app:          %d\n", $ng);
printf("size: %d -> %d bytes  (%.1f%% smaller)\n", $origLen, strlen($html), 100 * ($origLen - strlen($html)) / $origLen);
