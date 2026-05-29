<?php
/** Допоміжні функції для роботи із зображеннями та data: URL. */
namespace Meet;

require_once __DIR__ . '/db.php';

/**
 * `data:image/png;base64,....` → ['image/png', "...байти..."].
 * Кидає \InvalidArgumentException якщо формат не той.
 */
function parse_data_url(string $dataUrl): array
{
    if (!\preg_match('#^data:([^;]+);base64,(.+)$#s', $dataUrl, $m)) {
        throw new \InvalidArgumentException('expected data:<mime>;base64,<...>');
    }
    $blob = \base64_decode($m[2], true);
    if ($blob === false) {
        throw new \InvalidArgumentException('invalid base64 in data URL');
    }
    return [$m[1], $blob];
}

function blob_to_data_url(string $mime, string $blob): string
{
    return 'data:' . $mime . ';base64,' . \base64_encode($blob);
}

/** data: URL аватарки учасника (start|end). null якщо немає. */
function avatar_data_url(string $participantId, string $which = 'start'): ?string
{
    $blobCol = $which === 'end' ? 'avatar_end' : 'avatar';
    $mimeCol = $which === 'end' ? 'avatar_end_mime' : 'avatar_mime';
    $con = db();
    $row = one($con, "SELECT $blobCol AS blob, $mimeCol AS mime FROM participants WHERE device_id = ?", [$participantId]);
    // mime обовʼязковий — без нього вийшов би невалідний "data:None;base64,…".
    if (!$row || ($row['blob'] ?? null) === null || empty($row['mime'])) {
        return null;
    }
    return blob_to_data_url($row['mime'], $row['blob']);
}
