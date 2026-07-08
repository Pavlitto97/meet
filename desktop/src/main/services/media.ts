/** Допоміжне для зображень та data: URL (порт meeteditor/media.php). */
import { one, toBuffer } from './db';

/** `data:image/png;base64,...` → [mime, Buffer]. Кидає Error якщо формат не той. */
export function parseDataUrl(dataUrl: string): [string, Buffer] {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) {
    throw new Error('expected data:<mime>;base64,<...>');
  }
  const blob = Buffer.from(m[2], 'base64');
  if (blob.length === 0 && m[2].length > 0) {
    throw new Error('invalid base64 in data URL');
  }
  return [m[1], blob];
}

export function blobToDataUrl(mime: string, blob: Buffer): string {
  return 'data:' + mime + ';base64,' + blob.toString('base64');
}

const IMAGE_COLS: Record<string, [string, string]> = {
  start: ['avatar', 'avatar_mime'],
  end: ['avatar_end', 'avatar_end_mime'],
  source: ['source', 'source_mime'],
};

/** data: URL зображення учасника (start|end|source) за числовим id. null якщо немає. */
export function participantImageDataUrl(participantId: number, which: 'start' | 'end' | 'source' = 'start'): string | null {
  const [blobCol, mimeCol] = IMAGE_COLS[which] ?? IMAGE_COLS.start;
  const row = one(`SELECT ${blobCol} AS blob, ${mimeCol} AS mime FROM participants WHERE id = ?`, [participantId]);
  const blob = toBuffer(row?.blob);
  if (!row || blob === null || !row.mime) {
    return null;
  }
  return blobToDataUrl(row.mime, blob);
}
