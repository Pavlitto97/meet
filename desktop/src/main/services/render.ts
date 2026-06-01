/**
 * Генерація Meet HTML із правками (порт meeteditor/render.php).
 *
 * Текстова заміна по сирому HTML БАЙТАМИ — НЕ DOM-парсинг. Працюємо у latin1-рядку
 * (1 символ = 1 байт), тож індекси збігаються з байтовими офсетами PHP, а кирилиця/
 * mojibake лишаються байт-у-байт. На виході — Buffer (latin1) → ті самі байти.
 * PCRE-ліміту з PHP тут немає (V8 regex без backtrack_limit).
 */
import fs from 'node:fs';
import { all, toBuffer } from './db';
import { getSettings } from './settings';
import { meetHtmlPath } from './paths';
import { ORIGINAL_MEETING_CODE, ORIGINAL_TIME, ORIGINAL_PERIOD, emojiCodepoints } from './config';
import { parseCam, camIsServer, camHeadMarkup, degradeBlob } from './degrade';

const utf8ToLatin1 = (s: string) => Buffer.from(s, 'utf8').toString('latin1');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// index.html read-only й рендером не мутується — читаємо з диска ОДИН раз
// (latin1) і переюзаємо. Кожен рендер працює на копіях через slice/replace.
let cachedMeetHtml: string | null = null;

export async function renderMeet(which = 'start', fit: string | null = null, cam: string | null = null): Promise<Buffer> {
  if (which !== 'start' && which !== 'end') which = 'start';
  const { method: camMethod, intensity: camI } = parseCam(cam);

  if (cachedMeetHtml === null) cachedMeetHtml = fs.readFileSync(meetHtmlPath()).toString('latin1');
  let html = cachedMeetHtml;

  // Позиції всіх data-participant-id (індекс у latin1 == байтовий офсет).
  const occ: { start: number; end: number; pid: string }[] = [];
  const pidRe = /data-participant-id="([^"]+)"/g;
  let pm: RegExpExecArray | null;
  while ((pm = pidRe.exec(html)) !== null) {
    occ.push({ start: pm.index, end: pm.index + pm[0].length, pid: pm[1] });
  }

  const rows: Record<string, any> = {};
  for (const r of all(
    'SELECT device_id, original_name, custom_name, avatar, avatar_mime, avatar_end, avatar_end_mime FROM participants'
  )) {
    rows[r.device_id] = r;
  }

  // Збираємо правки src аватарок: [start, end, replacement].
  const edits: [number, number, string][] = [];
  const n = occ.length;
  for (let i = 0; i < n; i++) {
    const row = rows[occ[i].pid];
    if (!row) continue;
    const posEnd = occ[i].end;
    const bound = i + 1 < n ? occ[i + 1].start : html.length;
    const tile = html.slice(posEnd, bound);

    let blob: Buffer | null;
    let mime: string | null;
    // 'end' лише якщо avatar_end існує І непорожній — інакше фолбек на start (як PHP).
    const endBuf = which === 'end' ? toBuffer(row.avatar_end) : null;
    if (endBuf && endBuf.length > 0) {
      blob = endBuf;
      mime = row.avatar_end_mime;
    } else {
      blob = toBuffer(row.avatar);
      mime = row.avatar_mime;
    }
    if (blob && blob.length > 0 && mime) {
      // Серверні методи (gd/gd-jpeg) бейкають деградацію прямо в байти аватарки.
      if (camI > 0 && camIsServer(camMethod)) {
        [blob, mime] = await degradeBlob(blob, mime, camMethod, camI);
      }
      const dataUrl = 'data:' + mime + ';base64,' + blob.toString('base64');
      const imgRe = /<img\b[^>]*?\ssrc="([^"]*)"/g;
      let im: RegExpExecArray | null;
      while ((im = imgRe.exec(tile)) !== null) {
        // Значення src стоїть прямо перед закривальною лапкою матчу.
        const valStart = posEnd + im.index + (im[0].length - 1 - im[1].length);
        const valEnd = valStart + im[1].length;
        edits.push([valStart, valEnd, dataUrl]);
      }
    }
  }

  // Застосовуємо за спаданням позиції, щоб офсети не зсувались.
  edits.sort((a, b) => b[0] - a[0]);
  for (const [start, end, repl] of edits) {
    html = html.slice(0, start) + repl + html.slice(end);
  }

  // ─ імена: глобальна заміна (плитка + банер + лист учасників) ─
  const namePairs = all(
    "SELECT original_name, custom_name FROM participants WHERE custom_name IS NOT NULL AND custom_name != ''"
  );
  // Довші оригінали — перші (щоб короткі підрядки не псували довші).
  namePairs.sort((a, b) => b.original_name.length - a.original_name.length);
  for (const r of namePairs) {
    if (r.custom_name !== r.original_name) {
      html = html.replaceAll(r.original_name, utf8ToLatin1(r.custom_name));
    }
  }

  // ─ глобальні налаштування (код, час, період) ─
  const s = getSettings(false);
  const newCode = String((s.meeting_code ?? '') !== '' ? s.meeting_code : ORIGINAL_MEETING_CODE).trim();
  if (newCode !== '' && newCode !== ORIGINAL_MEETING_CODE) {
    html = html.replaceAll(ORIGINAL_MEETING_CODE, newCode);
  }

  const timeKey = which === 'end' ? 'end_time' : 'start_time';
  const periodKey = which === 'end' ? 'end_period' : 'start_period';
  const newTime = String((s[timeKey] ?? '') !== '' ? s[timeKey] : ORIGINAL_TIME).trim();
  if (newTime !== '' && newTime !== ORIGINAL_TIME) {
    html = html.replace(
      new RegExp(`(<span jsname="W5i7Bf">)${escapeRe(ORIGINAL_TIME)}(</span>)`),
      (_m, a, b) => a + newTime + b
    );
  }
  const newPeriod = String((s[periodKey] ?? '') !== '' ? s[periodKey] : ORIGINAL_PERIOD).trim();
  if (newPeriod !== '' && newPeriod !== ORIGINAL_PERIOD) {
    html = html.replace(
      new RegExp(`(<span jsname="d1rraf"[^>]*>)${escapeRe(ORIGINAL_PERIOD)}(</span>)`),
      (_m, a, b) => a + newPeriod + b
    );
  }

  // ─ emoji-кнопки реакцій: підміняємо src за data-emoji ─
  const emojiMap = emojiCodepoints();
  html = html.replace(
    /(<img\b[^>]*?\bdata-emoji="([^"]+)"[^>]*?\s)src="[^"]*"([^>]*?>)/g,
    (full, pre, emoji, post) => {
      const code = emojiMap[emoji];
      if (!code) return full;
      return pre + 'src="assets/img/emoji/' + code + '.png"' + post;
    }
  );

  // <base href="/"> + override-стилі (розтягнути кастомне data:-фото на всю плитку).
  let headInject =
    '<base href="/">' +
    '<style>' +
    '.oZRSLe:has(img.m0DVAf[src^="data:"]){position:relative!important;}' +
    '.oZRSLe img.m0DVAf[src^="data:"]{' +
    'position:absolute!important;inset:0!important;' +
    'width:100%!important;height:100%!important;' +
    'object-fit:cover!important;border-radius:inherit!important;' +
    'display:block!important;clip-path:none!important;z-index:5!important;}' +
    '.oZRSLe:has(img.m0DVAf[src^="data:"]) img.SOQwsf{display:none!important;}' +
    '</style>';

  // Браузерні методи деградації (css): фільтр накладе сам браузер при рендері.
  headInject += camHeadMarkup(camMethod, camI);

  // Скрін-режим ?fit=ШИРИНАxВИСОТА — масштабувати #yDmH0d під вікно (без білих полос).
  const fm = fit ? /^(\d+)x(\d+)$/.exec(fit) : null;
  if (fm) {
    const fitW = parseInt(fm[1], 10);
    const fitH = parseInt(fm[2], 10);
    let natW = 1728;
    let natH = 996;
    const nm = /id="yDmH0d"[^>]*style="[^"]*\bwidth:\s*(\d+)px;\s*height:\s*(\d+)px/.exec(html);
    if (nm) {
      natW = parseInt(nm[1], 10);
      natH = parseInt(nm[2], 10);
    }
    if (fitW > 0 && fitH > 0 && natW > 0 && natH > 0) {
      const sx = (fitW / natW).toFixed(6);
      const sy = (fitH / natH).toFixed(6);
      headInject +=
        '<style>' +
        'html,body{margin:0!important;padding:0!important;overflow:hidden!important;background:#000!important;}' +
        `#yDmH0d{transform:scale(${sx},${sy})!important;transform-origin:top left!important;}` +
        '</style>';
    }
  }

  const needle = '<head>';
  const idx = html.indexOf(needle);
  if (idx !== -1) {
    html = html.slice(0, idx) + needle + headInject + html.slice(idx + needle.length);
  }

  return Buffer.from(html, 'latin1');
}
