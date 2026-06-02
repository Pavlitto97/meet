// Pure helpers ported verbatim from the old assets/js/api.js (browser-only logic
// like canvas collage splitting stays client-side). escapeHtml/cssEsc are dropped —
// Vue templating auto-escapes and we bind by refs instead of querySelector.

/** Read an uploaded File as a data: URL (for avatar upload PUTs). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

/** Meet-style code xxx-xxxx-xxx. Alphabet has no 'l' (avoids confusion with 1). */
export function randomMeetingCode(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyz'
  const group = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  return `${group(3)}-${group(4)}-${group(3)}`
}

export function fmtBytes(n: number | string): string {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  return (v / 1024 / 1024).toFixed(2) + ' MB'
}

export function fmtDuration(sec: number): string {
  const s0 = Math.max(0, Math.round(Number(sec) || 0))
  const h = Math.floor(s0 / 3600)
  const m = Math.floor((s0 % 3600) / 60)
  const s = s0 % 60
  return (h ? `${h}г ` : '') + (m || h ? `${m}хв ` : '') + `${s}с`
}

export interface CollageResult {
  left: string
  right: string
  split: 'vertical' | 'horizontal'
}

/**
 * Split a 2-up collage into start/end halves. Tall images (H/W>1.3) split
 * top/bottom (vertical), otherwise left/right (horizontal). Floor-based sizes;
 * the second half takes the remainder so odd dimensions don't drop a pixel.
 */
export async function splitCollage(imageUrl: string): Promise<CollageResult> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('не вдалось завантажити згенероване зображення'))
    img.src = imageUrl
  })
  const W = img.naturalWidth
  const H = img.naturalHeight
  function crop(sx: number, sy: number, sw: number, sh: number): string {
    const c = document.createElement('canvas')
    c.width = sw
    c.height = sh
    c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    return c.toDataURL('image/png')
  }
  const isTall = H / W > 1.3
  if (isTall) {
    const halfH = Math.floor(H / 2)
    return { left: crop(0, 0, W, halfH), right: crop(0, halfH, W, H - halfH), split: 'vertical' }
  }
  const halfW = Math.floor(W / 2)
  return { left: crop(0, 0, halfW, H), right: crop(halfW, 0, W - halfW, H), split: 'horizontal' }
}

/** "10:34 PM" → { time: "10:34", period: "PM" }; null if it doesn't match. */
export function parseTime(str: string): { time: string; period: string } | null {
  const m = String(str).trim().match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i)
  return m ? { time: m[1], period: m[2].toUpperCase() } : null
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number): (...a: Parameters<T>) => void {
  let t: ReturnType<typeof setTimeout> | null = null
  return (...a: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}
