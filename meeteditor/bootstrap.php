<?php
/**
 * Завантажує весь бекенд-пакет (без побічних ефектів окрім реєстрації маршрутів).
 *
 * Порядок модулів без циклів:
 *   config → db/media/state → settings/openrouter/render/participants/generations/admin/screenshots
 *   → http → routes
 */
namespace Meet;

// Рендер вживляє multi-MB base64 data:URL у HTML; emoji-regex потім сканує цей
// великий рядок. Дефолтний pcre.backtrack_limit (1M) на ньому вичерпується
// («Backtrack limit exhausted»). Python-re такого ліміту не мав — піднімаємо.
\ini_set('pcre.backtrack_limit', '1000000000');
\ini_set('pcre.recursion_limit', '1000000000');

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/state.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/media.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/participants.php';
require_once __DIR__ . '/openrouter.php';
require_once __DIR__ . '/generations.php';
require_once __DIR__ . '/render.php';
require_once __DIR__ . '/screenshots.php';
require_once __DIR__ . '/degrade.php';
require_once __DIR__ . '/admin.php';
require_once __DIR__ . '/routes.php';
