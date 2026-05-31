/* Лабораторія webcam-деградації: перемикання підходів + сила, живе порівняння.
   Спирається на api.js (api(), makeToast()). PHP — єдине джерело правди для специфікацій
   фільтрів (/api/degrade-spec) і серверної обробки (/api/degrade-preview). */

const $ = (s) => document.querySelector(s);
const toast = makeToast();

const FIT = { w: 1280, h: 720 };               // логічний розмір iframe рендеру
let METHODS = [];                               // [{key,label,layer,desc}]
const specCache = new Map();                    // "method:intensity" → {filter,svg}
const state = { method: "none", intensity: 35, which: "start", did: null };

function methodMeta(key) { return METHODS.find((m) => m.key === key) || METHODS[0]; }
function camStr(method, I) { return method === "none" ? "" : `${method}:${I}`; }
function avatarUrl() { return `/api/avatar/${encodeURIComponent(state.did)}?which=${state.which}`; }
function previewUrl(method) {
  return `/api/degrade-preview?did=${encodeURIComponent(state.did)}&which=${state.which}` +
    `&cam=${encodeURIComponent(camStr(method, state.intensity))}&t=${Date.now()}`;
}

async function getSpec(method, I) {
  if (method === "none") return { filter: "", svg: "" };
  const key = `${method}:${I}`;
  if (specCache.has(key)) return specCache.get(key);
  const s = await api("GET", `/api/degrade-spec?cam=${encodeURIComponent(key)}`);
  specCache.set(key, s);
  return s;
}

// ─── Побудова контролів ──────────────────────────────────────────────────────
function buildMethods() {
  const seg = $("#seg");
  seg.innerHTML = "";
  const layerLabel = { none: "—", server: "сервер", browser: "браузер" };
  for (const m of METHODS) {
    const b = document.createElement("button");
    b.className = "secondary" + (m.key === state.method ? " sel" : "");
    b.dataset.key = m.key;
    b.innerHTML = `<span class="msym sm">${m.layer === "server" ? "memory" : m.layer === "browser" ? "web" : "block"}</span>` +
      `<span>${escapeHtml(m.label)}</span><span class="layer">${layerLabel[m.layer] || m.layer}</span>`;
    b.onclick = () => setMethod(m.key);
    seg.appendChild(b);
  }
}

function buildParticipants(list) {
  const sel = $("#participant");
  sel.innerHTML = "";
  for (const p of list) {
    const o = document.createElement("option");
    o.value = p.device_id;
    o.textContent = (p.custom_name || p.original_name || p.device_id) +
      (p.has_avatar ? "" : " (лише кінець)");
    sel.appendChild(o);
  }
  if (list[0]) state.did = list[0].device_id;
}

function syncControls() {
  $("#intensity").value = state.intensity;
  $("#intensity-val").textContent = state.intensity + "%";
  $("#which").value = state.which;
  if (state.did) $("#participant").value = state.did;
  $("#method-desc").textContent = methodMeta(state.method).desc || "";
  document.querySelectorAll("#seg button").forEach((b) =>
    b.classList.toggle("sel", b.dataset.key === state.method));
  $("#deg-cam").textContent = state.method === "none" ? "" : `· ${state.method}:${state.intensity}`;
}

// ─── Рендери ─────────────────────────────────────────────────────────────────
async function updateSingle() {
  if (!state.did) return;
  $("#orig-img").src = avatarUrl();
  const deg = $("#deg-img");
  deg.style.filter = "";
  const layer = methodMeta(state.method).layer;
  if (state.method === "none") {
    deg.src = avatarUrl();
  } else if (layer === "server") {
    deg.src = previewUrl(state.method);
  } else {
    deg.src = avatarUrl();
    const spec = await getSpec(state.method, state.intensity);
    deg.style.filter = spec.filter;
  }
}

async function updateGrid() {
  if (!state.did) return;
  // Браузерна специфікація фільтра на поточній силі (єдиний browser-метод — css).
  const cssSpec = await getSpec("css", state.intensity);
  const grid = $("#grid");
  grid.innerHTML = "";
  for (const m of METHODS) {
    const cell = document.createElement("div");
    cell.className = "gcell" + (m.key === state.method ? " sel" : "");
    cell.onclick = () => setMethod(m.key);
    const box = document.createElement("div");
    box.className = "imgbox";
    const img = document.createElement("img");
    if (m.key === "none") {
      img.src = avatarUrl();
    } else if (m.layer === "server") {
      img.src = previewUrl(m.key);
    } else {
      img.src = avatarUrl();
      img.style.filter = cssSpec.filter;
    }
    box.appendChild(img);
    const cap = document.createElement("div");
    cap.className = "gcap";
    cap.textContent = m.label;
    cell.append(box, cap);
    grid.appendChild(cell);
  }
}

function updateIframe() {
  const cam = camStr(state.method, state.intensity);
  const url = `/api/render?which=${state.which}&fit=${FIT.w}x${FIT.h}` +
    (cam ? `&cam=${encodeURIComponent(cam)}` : "");
  $("#frame").src = url;
  // «Повний рендер» у шапці — без fit (нативний розмір).
  $("#open-render").href = `/api/render?which=${state.which}` + (cam ? `&cam=${encodeURIComponent(cam)}` : "");
}

function scaleFrame() {
  const wrap = $("#frame-wrap");
  const frame = $("#frame");
  const scale = wrap.clientWidth / FIT.w;
  frame.style.width = FIT.w + "px";
  frame.style.height = FIT.h + "px";
  frame.style.transform = `scale(${scale})`;
  wrap.style.height = Math.round(FIT.h * scale) + "px";
}

// ─── Дебаунс ──────────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const renderLight = debounce(() => { updateSingle(); updateGrid(); }, 150);
const renderFrame = debounce(() => updateIframe(), 450);
function renderAll() { renderLight(); renderFrame(); }

// ─── Дії ─────────────────────────────────────────────────────────────────────
function setMethod(key) { state.method = key; syncControls(); renderAll(); }

async function saveDefault() {
  try {
    await api("PUT", "/api/settings", { cam_method: state.method, cam_intensity: String(state.intensity) });
    toast("Збережено як дефолт — скріни з адмінки тепер цим підходом", "ok");
  } catch (e) { toast(e.message, "err"); }
}

async function shoot() {
  const btn = $("#shoot");
  btn.disabled = true;
  toast("Роблю скрін через Chrome…");
  try {
    const cam = camStr(state.method, state.intensity) || "none";
    const r = await api("POST", "/api/screenshots",
      { which: state.which, width: 1920, height: 1080, cam, label: `lab ${cam}` });
    $("#shot").src = `/api/screenshot-image/${r.id}?t=${Date.now()}`;
    $("#shot-wrap").hidden = false;
    toast("Скрін готовий", "ok");
  } catch (e) {
    toast(e.message, "err");
  } finally {
    btn.disabled = false;
  }
}

// ─── Ініціалізація ─────────────────────────────────────────────────────────────
async function init() {
  try {
    METHODS = (await api("GET", "/api/degrade-methods")).methods || [];
    const ps = await api("GET", "/api/participants");
    const withAv = ps.filter((p) => p.has_avatar || p.has_avatar_end);
    const s = await api("GET", "/api/settings");
    state.method = s.cam_method || "none";
    state.intensity = Number(s.cam_intensity || 35);

    buildMethods();
    if (!withAv.length) {
      $("#participant").innerHTML = "<option>немає аватарок — згенеруй у адмінці</option>";
      toast("Немає учасників з аватарками — спочатку додай/згенеруй фото", "err");
    } else {
      buildParticipants(withAv);
    }
    syncControls();

    $("#intensity").addEventListener("input", (e) => {
      state.intensity = Number(e.target.value);
      $("#intensity-val").textContent = state.intensity + "%";
      $("#deg-cam").textContent = state.method === "none" ? "" : `· ${state.method}:${state.intensity}`;
      renderAll();
    });
    $("#which").addEventListener("change", (e) => { state.which = e.target.value; renderAll(); });
    $("#participant").addEventListener("change", (e) => { state.did = e.target.value; renderLight(); });
    $("#save-default").addEventListener("click", saveDefault);
    $("#reset").addEventListener("click", () => { state.method = "none"; state.intensity = 35; syncControls(); renderAll(); });
    $("#shoot").addEventListener("click", shoot);
    window.addEventListener("resize", debounce(scaleFrame, 100));

    scaleFrame();
    $("#frame").addEventListener("load", scaleFrame);
    renderAll();
  } catch (e) {
    toast("Помилка ініціалізації: " + e.message, "err");
  }
}

init();
