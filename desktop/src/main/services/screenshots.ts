/**
 * Скріни рендеру (порт meeteditor/screenshots.php). Зовнішній headless Chrome
 * замінено на власний прихований (offscreen) BrowserWindow + webContents.capturePage()
 * проти живого app://meet/api/render?which=…&fit=… — у Electron уже є Chromium.
 */
import { BrowserWindow } from 'electron';
import { all, one, run, logActivity, toBuffer } from './db';
import { getSetting } from './settings';
import { activeGroupId } from './groups';

const MIN_W = 320;
const MIN_H = 240;
const MAX_W = 3840;
const MAX_H = 2160;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Chromium завжди є в Electron — скріни доступні без зовнішнього браузера. */
export function chromeAvailable(): boolean {
  return true;
}

/** Знімає url у вікні width×height (deviceScaleFactor=1) → PNG Buffer або null. */
async function capturePng(url: string, width: number, height: number): Promise<Buffer | null> {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    useContentSize: true,
    webPreferences: {
      offscreen: true, // рендер без реального вікна, масштаб 1
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  let paintTimer: NodeJS.Timeout | undefined;
  try {
    // Перший намальований кадр (offscreen) або таймаут-запобіжник.
    const painted = new Promise<void>((resolve) => {
      paintTimer = setTimeout(resolve, 2000);
      win.webContents.once('paint', () => {
        if (paintTimer) clearTimeout(paintTimer);
        resolve();
      });
    });
    await win.loadURL(url);
    win.webContents.setZoomFactor(1);
    // Дочекатись готовності шрифтів (Meet — локальні woff2), щоб текст був стилізований.
    try {
      await win.webContents.executeJavaScript(
        '(document.fonts && document.fonts.ready) ? document.fonts.ready.then(() => true) : true'
      );
    } catch {
      /* ignore */
    }
    await painted;
    await sleep(250);
    let img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    // На HiDPI/Retina capturePage віддає кадр у масштабі дисплея (2×) — зводимо
    // рівно до запитаних width×height, щоб байти PNG збігалися з метаданими у БД.
    const sz = img.getSize();
    if (sz.width !== width || sz.height !== height) {
      img = img.resize({ width, height });
    }
    const png = img.toPNG();
    return png.length ? png : null;
  } finally {
    if (paintTimer) clearTimeout(paintTimer);
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Робить скрін рендеру (start|end) і складає у таблицю screenshots. */
export async function capture(
  which = 'start',
  width: any = 1280,
  height: any = 720,
  label: string | null = null,
  cam: string | null = null
): Promise<Record<string, any>> {
  which = which === 'end' ? 'end' : 'start';
  if (!Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) {
    return { error: 'width/height мають бути числами', _status: 400 };
  }
  const w = Math.max(MIN_W, Math.min(parseInt(String(width), 10), MAX_W));
  const h = Math.max(MIN_H, Math.min(parseInt(String(height), 10), MAX_H));

  // cam: явний аргумент має перевагу; інакше дефолт із settings.
  if (!cam || cam === '') {
    const m = getSetting('cam_method');
    if (m !== '' && m !== 'none') {
      const i = getSetting('cam_intensity');
      cam = m + ':' + (i !== '' ? i : '35');
    }
  }

  // Скрін знімається з активної групи (рендер сам бере activeGroupId, але
  // фіксуємо id явно — щоб історія показувала, з якої групи зроблено кадр).
  const groupId = activeGroupId();
  let url = `app://meet/api/render?which=${which}&fit=${w}x${h}&group=${groupId}`;
  if (cam && cam !== '' && cam !== 'none') url += '&cam=' + encodeURIComponent(cam);

  const png = await capturePng(url, w, h);
  if (!png) return { error: 'Не вдалось зробити скрін рендера', _status: 500 };

  const code = getSetting('meeting_code');
  const lbl = label && String(label).trim() !== '' ? String(label).trim() : null;
  const r = run(
    'INSERT INTO screenshots(which, image, image_mime, width, height, meeting_code, label, size_bytes, group_id) VALUES(?,?,?,?,?,?,?,?,?)',
    [which, png, 'image/png', w, h, code, lbl, png.length, groupId]
  );
  const sid = r.lastInsertRowid;
  logActivity('screenshot.capture', `#${sid} ${which} ${w}x${h} ${png.length}B (група ${groupId})`);
  return { id: sid, which, width: w, height: h, size_bytes: png.length };
}

export function listScreenshots(which: string | null): any[] {
  let sql =
    'SELECT s.id, s.which, s.image_mime, s.width, s.height, s.meeting_code, s.label, s.size_bytes, ' +
    's.created_at, (s.image IS NOT NULL) AS has_image, s.group_id, g.name AS group_name ' +
    'FROM screenshots s LEFT JOIN groups g ON g.id = s.group_id WHERE 1=1';
  const args: unknown[] = [];
  if (which === 'start' || which === 'end') {
    sql += ' AND s.which = ?';
    args.push(which);
  }
  sql += ' ORDER BY s.id DESC LIMIT 200';
  return all(sql, args);
}

export function screenshotImage(sid: number): [Buffer, string] | null {
  const row = one('SELECT image, image_mime FROM screenshots WHERE id = ?', [sid]);
  const blob = toBuffer(row?.image);
  if (!row || !blob) return null;
  return [blob, row.image_mime || 'image/png'];
}

export function deleteScreenshot(sid: number): Record<string, any> {
  run('DELETE FROM screenshots WHERE id = ?', [sid]);
  logActivity('screenshot.delete', `#${sid}`);
  return { ok: true };
}

export function bulkDeleteScreenshots(scope: string): Record<string, any> {
  let r: { changes: number };
  if (scope === 'all') {
    r = run('DELETE FROM screenshots');
  } else if (scope === 'start' || scope === 'end') {
    r = run('DELETE FROM screenshots WHERE which = ?', [scope]);
  } else {
    return { error: 'scope має бути start|end|all', _status: 400 };
  }
  logActivity('screenshot.bulk_delete', `${scope}: ${r.changes}`);
  return { ok: true, deleted: r.changes };
}
