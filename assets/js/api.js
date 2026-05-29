/* Спільні утиліти редактора й адмінки. Завантажується перед editor.js / admin.js.
   Без модулів/бандлерів — звичайні глобальні функції. */

async function api(method, path, body) {
  const opts = { method };
  if (body !== undefined) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(path, opts);
  const ct = r.headers.get("Content-Type") || "";
  const payload = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) {
    const msg = (payload && payload.error) ? payload.error : `${method} ${path} → ${r.status}`;
    throw new Error(msg);
  }
  return payload;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function cssEsc(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/(["\\])/g, "\\$1");
}

// Генератор коду зустрічі у форматі xxx-xxxx-xxx (як у Google Meet).
function randomMeetingCode() {
  const alphabet = "abcdefghijkmnopqrstuvwxyz"; // без l — щоб не плутати з 1
  const group = n => Array.from({ length: n }, () =>
    alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${group(3)}-${group(4)}-${group(3)}`;
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}г ` : "") + (m || h ? `${m}хв ` : "") + `${s}с`;
}

// Розрізає колаж із 2 кадрів на ліве/праве (або верх/низ для високих картинок).
// Промт «paired images» від Gemini зазвичай дає два обличчя поруч.
async function splitCollage(imageUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("не вдалось завантажити згенероване зображення"));
    img.src = imageUrl;
  });
  const W = img.naturalWidth, H = img.naturalHeight;
  function crop(sx, sy, sw, sh) {
    const c = document.createElement("canvas");
    c.width = sw; c.height = sh;
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return c.toDataURL("image/png");
  }
  const isTall = H / W > 1.3;
  if (isTall) {
    const halfH = Math.floor(H / 2);
    return { left: crop(0, 0, W, halfH), right: crop(0, halfH, W, H - halfH), split: "vertical" };
  }
  const halfW = Math.floor(W / 2);
  return { left: crop(0, 0, halfW, H), right: crop(halfW, 0, W - halfW, H), split: "horizontal" };
}

// Статус-рядок (редактор): елемент <span class="status">.
function makeStatus(el) {
  let timer = null;
  return function setStatus(msg, cls = "") {
    el.textContent = msg;
    el.className = "status " + cls;
    if (timer) clearTimeout(timer);
    if (cls === "ok") {
      timer = setTimeout(() => { el.textContent = ""; el.className = "status"; }, 1800);
    }
  };
}

// Тост-сповіщення (адмінка): плаваюча плашка внизу.
function makeToast() {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  let timer = null;
  return function toast(msg, cls = "") {
    el.textContent = msg;
    el.className = "toast show " + cls;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { el.className = "toast " + cls; }, 2600);
  };
}
