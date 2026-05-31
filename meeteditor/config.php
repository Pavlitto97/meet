<?php
/**
 * Шляхи, константи та дефолтні дані проєкту.
 *
 * Тут немає логіки — лише значення (аналог колишнього config.py). Жодних
 * залежностей від решти пакета, щоб не було циклів: усі модулі тягнуть config.
 */
namespace Meet;

// ─── Допоміжне: mojibake-перетворення ────────────────────────────────────────
// Кожен байт рядка трактуємо як Latin-1 codepoint і кодуємо назад у UTF-8.
// Саме так свого часу зіпсувались кирилічні імена у збереженій сторінці Meet:
// оригінальні UTF-8 байти імені були ще раз UTF-8-закодовані через latin1.
// Будуємо дефолтні original_name тим самим перетворенням — щоб збігалось байт-у-байт.
function latin1_to_utf8(string $s): string
{
    $o = '';
    for ($i = 0, $n = strlen($s); $i < $n; $i++) {
        $c = ord($s[$i]);
        $o .= $c < 0x80 ? $s[$i] : chr(0xC0 | ($c >> 6)) . chr(0x80 | ($c & 0x3F));
    }
    return $o;
}

// ─── Шляхи ───────────────────────────────────────────────────────────────────
// config.php лежить у meeteditor/, тому корінь проєкту — на рівень вище.
define('Meet\ROOT', \dirname(__DIR__));
define('Meet\DB_PATH', ROOT . '/data.db');
define('Meet\MEET_HTML', ROOT . '/index.html');
define('Meet\MEET_HTML_BAK', ROOT . '/index.html.bak');
define('Meet\PROMPT_FILE', ROOT . '/promt.md');
define('Meet\ENV_FILE', ROOT . '/.env');

const HOST = '127.0.0.1';
// Порт можна задати через змінну середовища PORT або прапорець --port (див. server.php).
function default_port(): int
{
    $p = \getenv('PORT');
    return $p !== false && $p !== '' ? (int) $p : 8000;
}

// ─── OpenRouter ────────────────────────────────────────────────────────────────
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const DEFAULT_GEN_MODEL = 'google/gemini-2.5-flash-image';
const DEFAULT_GEN_PROVIDER = 'google-ai-studio';
const DEFAULT_GEN_TIER = 'default';

// ─── Дефолтні учасники ─────────────────────────────────────────────────────────
// [device_id, original_name (як у HTML), custom_name|null (дефолтне відображуване), skipped]
// Pavlo Grinevich (126) і «3 others» (136/137/138) у UI не показуємо.
// custom_name заливається при ініціалізації БД — щоб одразу були нормальні
// Cyrillic-імена замість mojibake-байтів з HTML.
//
// Імена, що закінчуються на «я» (Саня/Ваня/Даня): у збереженій сторінці
// загубився останній байт 0x8F (C1-control) — тож mojibake обривається на Ñ.
// Тому pre-image для них — "Сан\xD1" (а не "Саня"), щоб байти збіглись із HTML.
function default_participants(): array
{
    return [
        ['spaces/mBsECBRYcS4B/devices/127', 'Sandro Machaidze',              'Sandro Machaidze', false],
        ['spaces/mBsECBRYcS4B/devices/129', latin1_to_utf8("Сан\xD1"),       'Саня',             false],
        ['spaces/mBsECBRYcS4B/devices/131', latin1_to_utf8("Ван\xD1"),       'Ваня',             false],
        ['spaces/mBsECBRYcS4B/devices/132', latin1_to_utf8("Дан\xD1"),       'Даня',             false],
        ['spaces/mBsECBRYcS4B/devices/133', latin1_to_utf8('Дима'),          'Дима',             false],
        ['spaces/mBsECBRYcS4B/devices/134', latin1_to_utf8('Микита'),        'Микита',           false],
        ['spaces/mBsECBRYcS4B/devices/135', latin1_to_utf8("Микола\\"),      'Микола',           false],
        ['spaces/mBsECBRYcS4B/devices/126', 'Pavlo Grinevich',                null,               true],
        ['spaces/mBsECBRYcS4B/devices/136', latin1_to_utf8('Гриша'),         null,               true],
        ['spaces/mBsECBRYcS4B/devices/137', latin1_to_utf8('Павло'),         null,               true],
        ['spaces/mBsECBRYcS4B/devices/138', latin1_to_utf8('Кирило'),        null,               true],
    ];
}

// ─── Дефолтні налаштування ───────────────────────────────────────────────────────
const DEFAULT_SETTINGS = [
    // Час «початку» і «кінця» зустрічі — ми малюємо ДВА рендери (on-start / on-end).
    'start_time'         => '10:34',
    'start_period'       => 'PM',
    'end_time'           => '11:15',
    'end_period'         => 'PM',
    'meeting_code'       => 'yrt-kczi-csw',   // хеш зустрічі
    'openrouter_api_key' => '',               // порожньо = не задано
    'gen_model'          => DEFAULT_GEN_MODEL,
    'gen_provider'       => DEFAULT_GEN_PROVIDER,
    'gen_tier'           => DEFAULT_GEN_TIER,
    // Webcam-деградація аватарок (лабораторія підходів). 'none' = вимкнено →
    // дефолтний /api/render лишається байт-у-байт. Метод: none|gd|gd-jpeg|css|svg.
    'cam_method'         => 'none',
    'cam_intensity'      => '35',     // 0..100, застосовується лише коли method != none
];

// Секретні поля — назовні віддаємо лише факт «встановлено/ні».
const SECRET_SETTING_KEYS = ['openrouter_api_key'];

function allowed_setting_keys(): array
{
    return \array_keys(DEFAULT_SETTINGS);
}

// ─── Початкові значення у HTML (що саме шукати для заміни) ───────────────────────
const ORIGINAL_MEETING_CODE = 'yrt-kczi-csw';
const ORIGINAL_TIME = '10:34';
const ORIGINAL_PERIOD = 'PM';

// ─── Emoji у нижньому реакц-тулбарі ──────────────────────────────────────────────
// data-emoji у HTML — double-encoded mojibake оригінальних emoji-байтів. Ключі
// будуємо тим самим перетворенням latin1_to_utf8, щоб збігалося з тим, що в HTML.
function emoji_codepoints(): array
{
    $real = [
        '💖' => '1f496', '👍' => '1f44d', '🎉' => '1f389', '👏' => '1f44f', '😂' => '1f602',
        '😮' => '1f62e', '😢' => '1f622', '🤔' => '1f914', '👎' => '1f44e', '🍆' => '1f346',
    ];
    $out = [];
    foreach ($real as $e => $code) {
        $out[latin1_to_utf8($e)] = $code;
    }
    return $out;
}

// MIME за розширенням — для статики.
const STATIC_CONTENT_TYPES = [
    'html'  => 'text/html; charset=utf-8',
    'css'   => 'text/css; charset=utf-8',
    'js'    => 'application/javascript; charset=utf-8',
    'svg'   => 'image/svg+xml',
    'png'   => 'image/png',
    'jpg'   => 'image/jpeg',
    'jpeg'  => 'image/jpeg',
    'webp'  => 'image/webp',
    'woff'  => 'font/woff',
    'woff2' => 'font/woff2',
    'json'  => 'application/json; charset=utf-8',
];
