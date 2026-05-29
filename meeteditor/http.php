<?php
/**
 * HTTP-абстракції: Request/Response, мінімальний роутер (метод+regex → хендлер)
 * і віддача статики з безпекою шляхів.
 *
 * Хендлери тонкі — приймають Request, повертають Response або масив (→ JSON).
 * Масив із ключем `_status` стає HTTP-кодом помилки; решта — JSON 200.
 */
namespace Meet;

require_once __DIR__ . '/config.php';

class Response
{
    public int $status;
    public string $body;
    public string $contentType;
    public array $headers;

    public function __construct(int $status = 200, string $body = '', string $contentType = 'application/octet-stream', array $headers = [])
    {
        $this->status = $status;
        $this->body = $body;
        $this->contentType = $contentType;
        $this->headers = $headers;
    }

    public static function json($payload, int $status = 200, array $headers = []): Response
    {
        $body = \json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        return new Response($status, $body, 'application/json; charset=utf-8', $headers);
    }

    public static function text(string $body, int $status = 200, string $contentType = 'text/plain; charset=utf-8', array $headers = []): Response
    {
        return new Response($status, $body, $contentType, $headers);
    }
}

class Request
{
    public string $method;
    public string $path;
    public array $query;
    public array $params = [];   // path-параметри з regex
    public string $rawBody;
    private $jsonCache = null;
    private bool $jsonParsed = false;

    public function __construct(string $method, string $path, array $query, string $rawBody)
    {
        $this->method = $method;
        $this->path = $path;
        $this->query = $query;
        $this->rawBody = $rawBody;
    }

    public function json(): array
    {
        if (!$this->jsonParsed) {
            $this->jsonParsed = true;
            $d = $this->rawBody !== '' ? \json_decode($this->rawBody, true) : [];
            $this->jsonCache = \is_array($d) ? $d : [];
        }
        return $this->jsonCache;
    }

    public function q(string $key, $default = null)
    {
        return $this->query[$key] ?? $default;
    }
}

/** Реєстрація маршруту. Patterns — regex без якорів; іменовані групи (?P<id>…) → params. */
function route(string $method, string $pattern, callable $fn): void
{
    $GLOBALS['__MEET_ROUTES'][] = [\strtoupper($method), '#^' . $pattern . '$#', $fn];
}

function coerce($result): Response
{
    if ($result instanceof Response) {
        return $result;
    }
    if (\is_array($result)) {
        $status = 200;
        if (\array_key_exists('_status', $result)) {
            $status = (int) $result['_status'];
            unset($result['_status']);
        }
        return Response::json($result, $status);
    }
    if ($result === null) {
        return Response::text('');
    }
    return Response::text((string) $result);
}

function dispatch(Request $req): Response
{
    foreach ($GLOBALS['__MEET_ROUTES'] ?? [] as [$method, $rx, $fn]) {
        if ($method !== $req->method) {
            continue;
        }
        if (\preg_match($rx, $req->path, $m)) {
            $params = [];
            foreach ($m as $k => $v) {
                if (\is_string($k)) {
                    $params[$k] = $v;
                }
            }
            $req->params = $params;
            return coerce($fn($req));
        }
    }
    // нічого не співпало: GET → статика, інакше 404
    if ($req->method === 'GET') {
        return serve_file($req->path);
    }
    return Response::json(['error' => 'no route'], 404);
}

/** Статика з ROOT з безпекою шляхів (не пускає за межі кореня). */
function serve_file(string $path): Response
{
    if ($path === '/' || $path === '') {
        $path = '/editor.html';
    }
    $rel = \rawurldecode(\ltrim($path, '/'));
    $real = \realpath(ROOT . '/' . $rel);
    $rootReal = \realpath(ROOT);
    if ($real === false || \strncmp($real, $rootReal . '/', \strlen($rootReal) + 1) !== 0) {
        // не існує — 404; існує, але поза коренем — заборонено
        if ($real !== false) {
            return Response::text('forbidden', 403);
        }
        return Response::text('not found', 404);
    }
    if (!\is_file($real)) {
        return Response::text('not found', 404);
    }
    $ext = \strtolower(\pathinfo($real, PATHINFO_EXTENSION));
    $ctype = STATIC_CONTENT_TYPES[$ext] ?? 'application/octet-stream';
    return new Response(200, (string) \file_get_contents($real), $ctype);
}

/** Відправляє Response у вбудований веб-сервер. */
function send(Response $resp): void
{
    \http_response_code($resp->status);
    \header('Content-Type: ' . $resp->contentType);
    \header('Content-Length: ' . \strlen($resp->body));
    foreach ($resp->headers as $k => $v) {
        \header($k . ': ' . $v);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        echo $resp->body;
    }
}

/** Будує Request із суперглобалів поточного запиту php -S. */
function request_from_globals(): Request
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $path = (string) \parse_url($uri, PHP_URL_PATH);
    $queryStr = (string) (\parse_url($uri, PHP_URL_QUERY) ?? '');
    $query = [];
    if ($queryStr !== '') {
        \parse_str($queryStr, $query);
    }
    $raw = \file_get_contents('php://input');
    return new Request($method, $path, $query, $raw === false ? '' : $raw);
}
