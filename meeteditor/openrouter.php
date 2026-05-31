<?php
/**
 * Клієнт OpenRouter — генерація зображень (chat.completions з modalities) і баланс.
 * Через cURL (вбудоване розширення PHP).
 */
namespace Meet;

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/media.php';

/** HTTP-помилка від OpenRouter — несе код і тіло, щоб маршрут /api/credits їх показав. */
class OpenRouterHttpError extends \RuntimeException
{
    public int $httpCode;
    public string $httpBody;

    public function __construct(int $code, string $body)
    {
        $this->httpCode = $code;
        $this->httpBody = $body;
        parent::__construct("HTTP $code: $body", $code);
    }
}

/**
 * Модель відповіла 200 OK, але без зображення (лише текст/відмова).
 * Несе текст відповіді й finish_reason, щоб помилка пояснювала ПРИЧИНУ
 * (часто Gemini відмовляє редагувати фото реальних людей). $retryable=false
 * для жорстких блоків (content_filter/refusal) — ретраї там не допоможуть.
 */
class EmptyImageError extends \RuntimeException
{
    public ?string $modelText;
    public ?string $finishReason;
    public bool $retryable;

    public function __construct(?string $modelText, ?string $finishReason, bool $retryable)
    {
        $this->modelText = ($modelText !== null && \trim($modelText) !== '') ? \trim($modelText) : null;
        $this->finishReason = $finishReason;
        $this->retryable = $retryable;
        // Фраза «не повернула зображення» — стабільний маркер для UI (бейдж «порожньо»).
        $msg = 'OpenRouter: модель не повернула зображення';
        if ($this->finishReason) {
            $msg .= " (finish_reason={$this->finishReason})";
        }
        if ($this->modelText !== null) {
            $msg .= '. Відповідь моделі: «' . \mb_substr($this->modelText, 0, 300) . '»';
        } else {
            $msg .= ' і без тексту — імовірно транзієнтний збій, спробуй ще раз.';
        }
        parent::__construct($msg);
    }
}

function or_headers(string $apiKey): array
{
    return [
        'Authorization' => 'Bearer ' . $apiKey,
        'Content-Type'  => 'application/json',
        // Доброзичливі заголовки рекомендовані доками OpenRouter
        'HTTP-Referer'  => 'http://localhost:8000/',
        'X-Title'       => 'Meet Editor',
    ];
}

/** Виконує HTTP-запит, повертає [status, body]. Кидає RuntimeException на мережеву помилку. */
function or_request(string $method, string $url, array $headers, ?string $body, int $timeout): array
{
    $ch = \curl_init($url);
    $hdr = [];
    foreach ($headers as $k => $v) {
        $hdr[] = "$k: $v";
    }
    \curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $hdr,
        CURLOPT_TIMEOUT        => $timeout,
        CURLOPT_CONNECTTIMEOUT => 30,
    ]);
    if ($body !== null) {
        \curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $resp = \curl_exec($ch);
    if ($resp === false) {
        $err = \curl_error($ch);
        \curl_close($ch);
        throw new \RuntimeException("мережева помилка: $err");
    }
    $status = (int) \curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    \curl_close($ch);
    return [$status, (string) $resp];
}

function fetch_credits(string $apiKey): array
{
    [$status, $body] = or_request('GET', OPENROUTER_CREDITS_URL, or_headers($apiKey), null, 30);
    if ($status < 200 || $status >= 300) {
        throw new OpenRouterHttpError($status, $body);
    }
    return \json_decode($body, true) ?? [];
}

/** Викликає chat.completions з modalities=[text,image] і повертає декодований JSON. */
function call_image(string $apiKey, string $model, string $provider, string $serviceTier, string $prompt, ?string $inputImageDataUrl): array
{
    // OpenRouter повертає 404 "No endpoints support modalities text,image", якщо
    // модель не вміє генерувати картинки. Відсікаємо з зрозумілою помилкою.
    if (\strpos(\strtolower($model), 'image') === false) {
        throw new \RuntimeException(
            "Модель «$model» не підтримує генерацію зображень. "
            . "Вибери модель з «image» в назві (напр. google/gemini-2.5-flash-image)."
        );
    }
    $content = [['type' => 'text', 'text' => $prompt]];
    if ($inputImageDataUrl) {
        $content[] = ['type' => 'image_url', 'image_url' => ['url' => $inputImageDataUrl]];
    }
    $payload = [
        'model'      => $model,
        'modalities' => ['text', 'image'],
        'messages'   => [['role' => 'user', 'content' => $content]],
        // 16:9 → горизонтальний канвас під 2-кадровий side-by-side колаж.
        'image_config' => ['aspect_ratio' => '16:9'],
        'usage'      => ['include' => true],
    ];
    if ($serviceTier && $serviceTier !== 'default') {
        $payload['service_tier'] = $serviceTier;
    }
    if ($provider) {
        $payload['provider'] = ['only' => [$provider], 'allow_fallbacks' => false];
    }
    $json = \json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    [$status, $resp] = or_request('POST', OPENROUTER_URL, or_headers($apiKey), $json, 180);
    if ($status < 200 || $status >= 300) {
        // OpenRouter повертає JSON з error.message — піднімаємо як виключення.
        throw new \RuntimeException("OpenRouter HTTP $status: $resp");
    }
    return \json_decode($resp, true) ?? [];
}

/** Витягує першу картинку з відповіді OpenRouter → [mime, bytes]. */
function extract_image(array $resp): array
{
    $choices = $resp['choices'] ?? [];
    if (!$choices) {
        throw new \RuntimeException('OpenRouter: choices порожній');
    }
    $msg = $choices[0]['message'] ?? [];
    // Варіант 1: окремий масив images
    foreach (($msg['images'] ?? []) as $img) {
        $url = \is_array($img) ? ($img['image_url']['url'] ?? null) : null;
        if ($url && \str_starts_with($url, 'data:')) {
            return parse_data_url($url);
        }
    }
    // Варіант 2: content як масив частин
    $content = $msg['content'] ?? null;
    if (\is_array($content)) {
        foreach ($content as $part) {
            if (\is_array($part) && ($part['type'] ?? null) === 'image_url') {
                $url = $part['image_url']['url'] ?? null;
                if ($url && \str_starts_with($url, 'data:')) {
                    return parse_data_url($url);
                }
            }
        }
    }
    // Зображення немає. Витягуємо текст/відмову й finish_reason, щоб помилка
    // пояснювала причину. content_filter або поле refusal — жорсткий блок (ретрай
    // не допоможе); інакше вважаємо транзієнтним і дозволяємо ретрай.
    $finish = $choices[0]['finish_reason'] ?? null;
    $hardBlock = !empty($msg['refusal']) || $finish === 'content_filter';
    throw new EmptyImageError(extract_text($msg), $finish, !$hardBlock);
}

/** Текст відповіді моделі (refusal / рядковий content / text-частини) або null. */
function extract_text(array $msg): ?string
{
    if (!empty($msg['refusal']) && \is_string($msg['refusal'])) {
        return $msg['refusal'];
    }
    $content = $msg['content'] ?? null;
    if (\is_string($content)) {
        return $content;
    }
    if (\is_array($content)) {
        $texts = [];
        foreach ($content as $part) {
            if (\is_array($part) && ($part['type'] ?? null) === 'text' && !empty($part['text'])) {
                $texts[] = $part['text'];
            }
        }
        return $texts ? \implode(' ', $texts) : null;
    }
    return null;
}
