/* Адмін-панель Meet. Спільні утиліти — в api.js (підключається раніше). */
const toast = makeToast();
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ENC = encodeURIComponent;
async function call(method, path, body) {
  try {
    const r = await api(method, path, body);
    return r;
  } catch (e) {
    toast(e.message, "err");
    throw e;
  }
}

// ─── Діалоги (заміна нативних prompt/confirm на in-app Material-модалки) ───────
function modalShell(inner) {
  const bg = document.createElement("div");
  bg.className = "modal-bg show";
  bg.innerHTML = `<div class="modal modal-sm" role="dialog" aria-modal="true">${inner}</div>`;
  document.body.appendChild(bg);
  return bg;
}
/** Текстовий ввід. Повертає Promise<string|null> (null = скасовано). */
function promptModal({ title = "", label = "", placeholder = "", value = "", okText = "OK" } = {}) {
  return new Promise(resolve => {
    const bg = modalShell(
      `<h3>${escapeHtml(title)}</h3>` +
      (label ? `<label class="modal-label">${escapeHtml(label)}</label>` : "") +
      `<input class="modal-input" type="text" placeholder="${escapeHtml(placeholder)}">` +
      `<div class="modal-actions"><button class="secondary" data-act="cancel">Скасувати</button><button data-act="ok">${escapeHtml(okText)}</button></div>`
    );
    const input = bg.querySelector(".modal-input");
    input.value = value;
    const done = v => { document.removeEventListener("keydown", onKey, true); bg.remove(); resolve(v); };
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(null); } else if (e.key === "Enter") { e.preventDefault(); done(input.value); } }
    bg.querySelector('[data-act="cancel"]').onclick = () => done(null);
    bg.querySelector('[data-act="ok"]').onclick = () => done(input.value);
    bg.addEventListener("mousedown", e => { if (e.target === bg) done(null); });
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}
/** Підтвердження. Повертає Promise<boolean>. */
function confirmModal({ title = "", message = "", okText = "OK", danger = false } = {}) {
  return new Promise(resolve => {
    const bg = modalShell(
      `<h3>${escapeHtml(title)}</h3>` +
      (message ? `<p class="modal-msg">${escapeHtml(message)}</p>` : "") +
      `<div class="modal-actions"><button class="secondary" data-act="cancel">Скасувати</button><button data-act="ok"${danger ? ' class="reject"' : ''}>${escapeHtml(okText)}</button></div>`
    );
    const done = v => { document.removeEventListener("keydown", onKey, true); bg.remove(); resolve(v); };
    function onKey(e) { if (e.key === "Escape") { e.preventDefault(); done(false); } else if (e.key === "Enter") { e.preventDefault(); done(true); } }
    bg.querySelector('[data-act="cancel"]').onclick = () => done(false);
    bg.querySelector('[data-act="ok"]').onclick = () => done(true);
    bg.addEventListener("mousedown", e => { if (e.target === bg) done(false); });
    document.addEventListener("keydown", onKey, true);
    requestAnimationFrame(() => bg.querySelector('[data-act="ok"]').focus());
  });
}

// ─── Вкладки ───────────────────────────────────────────────────────────────
const loaders = {};            // tab → async loader
const loadedOnce = new Set();
function activateTab(name) {
  $$("#tabs .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $$(".panel").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  location.hash = name;
  if (loaders[name]) loaders[name]();
  if (name === "generations") genPoll.start(); else genPoll.stop();
}
$$("#tabs .tab").forEach(t => t.addEventListener("click", () => activateTab(t.dataset.tab)));
// Deep-link / back-forward: реагуємо на зміну хешу (activateTab сам пише хеш —
// guard на «вже активна» гасить повторний прохід).
window.addEventListener("hashchange", () => {
  const name = (location.hash || "#participants").slice(1);
  const cur = $("#tabs .tab.active") && $("#tabs .tab.active").dataset.tab;
  if (name !== cur && $(`#tabs .tab[data-tab="${name}"]`)) activateTab(name);
});

// ════════════════════════════════════════════════════════════════════════════
// СПІЛЬНЕ: картка-показник + дії рендеру в шапці
// ════════════════════════════════════════════════════════════════════════════
function statCard(label, value, sub = "", cls = "") {
  return `<div class="stat-card ${cls}"><span class="label">${escapeHtml(label)}</span>` +
         `<span class="value">${value}</span>` +
         (sub ? `<span class="sub">${escapeHtml(sub)}</span>` : "") + `</div>`;
}
// Дії рендеру (перенесені з колишнього «Огляду») живуть у шапці. href лишається
// як graceful fallback; JS додає cache-bust, щоб прев'ю завжди було свіже.
$("#hd-preview-start").addEventListener("click", e => { e.preventDefault(); window.open("/api/render?which=start&t=" + Date.now(), "meet-start"); });
$("#hd-preview-end").addEventListener("click", e => { e.preventDefault(); window.open("/api/render?which=end&t=" + Date.now(), "meet-end"); });
$("#hd-dl-start").addEventListener("click", e => { e.preventDefault(); location.href = "/api/render?which=start&download=1"; });
$("#hd-dl-end").addEventListener("click", e => { e.preventDefault(); location.href = "/api/render?which=end&download=1"; });

// ════════════════════════════════════════════════════════════════════════════
// УЧАСНИКИ
// ════════════════════════════════════════════════════════════════════════════
let participantsCache = [];
let pendingUpload = null;       // {did} — для якого учасника обрано файл

function thumb(p, which) {
  const has = which === "end" ? p.has_avatar_end : p.has_avatar;
  if (!has) return `<span class="thumb empty" title="немає"></span>`;
  return `<img class="thumb" title="${which}" src="/api/avatar/${ENC(p.device_id)}?which=${which}&t=${Date.now()}">`;
}

function participantRow(p, idx, total) {
  const up = `<button class="iconbtn btn-sm" data-act="up" title="вище"${idx === 0 ? " disabled" : ""}><span class="msym sm">arrow_upward</span></button>`;
  const down = `<button class="iconbtn btn-sm" data-act="down" title="нижче"${idx >= total - 1 ? " disabled" : ""}><span class="msym sm">arrow_downward</span></button>`;
  const tags = (p.user_added ? `<span class="badge user">вручну</span> ` : "");
  return `<tr data-id="${escapeHtml(p.device_id)}" class="${p.skipped ? "skipped" : ""}">
    <td><div class="num-cell"><span class="rownum mono">${idx + 1}</span><div class="reorder">${up}${down}</div></div></td>
    <td><div class="flex" style="gap:6px">${thumb(p, "start")}${thumb(p, "end")}</div></td>
    <td><input class="i-name" value="${escapeHtml(p.custom_name || "")}" placeholder="${escapeHtml(p.original_name || "")}">${tags ? "<div style='margin-top:4px'>" + tags + "</div>" : ""}</td>
    <td style="text-align:center"><input type="checkbox" class="i-skip" ${p.skipped ? "checked" : ""}></td>
    <td><div class="flex" style="gap:4px">
      <button class="iconbtn btn-sm" data-act="upload" title="завантажити фото (початок)"><span class="msym sm">upload</span></button>
      <button class="iconbtn btn-sm" data-act="gen" ${p.skipped ? "disabled" : ""} title="згенерувати AI-колаж"><span class="msym sm">auto_awesome</span></button>
      <button class="iconbtn btn-sm" data-act="clear" title="прибрати аватарки"><span class="msym sm">close</span></button>
      ${p.user_added ? `<button class="iconbtn btn-sm danger" data-act="del" title="видалити"><span class="msym sm">delete</span></button>` : ""}
    </div></td>
  </tr>`;
}

loaders.participants = async () => {
  participantsCache = await call("GET", "/api/participants");
  const tb = $("#p-table tbody");
  tb.innerHTML = participantsCache.map((p, i) => participantRow(p, i, participantsCache.length)).join("");
  participantsCache.forEach(p => wireParticipantRow(p));
};

function wireParticipantRow(p) {
  const tr = $(`#p-table tbody tr[data-id="${cssEsc(p.device_id)}"]`);
  if (!tr) return;
  const did = p.device_id;
  const save = (body, msg) => call("PUT", `/api/participants/${ENC(did)}`, body).then(() => toast(msg || "Збережено", "ok"));

  $(".i-name", tr).addEventListener("change", e => save({ custom_name: e.target.value || null }));
  $(".i-skip", tr).addEventListener("change", e => save({ skipped: e.target.checked ? 1 : 0 }).then(() => loaders.participants()));

  tr.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "up" || act === "down") {
      const order = participantsCache.map(x => x.device_id);
      const i = order.indexOf(did);
      const j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      await call("POST", "/api/participants/reorder", { order });
      await loaders.participants();
    } else if (act === "upload") {
      pendingUpload = { did };
      $("#p-file").click();
    } else if (act === "gen") {
      try {
        const r = await call("POST", "/api/generate", { participant_id: did });
        toast(`Генерація #${r.id} стартувала — дивись вкладку «Генерації»`, "ok");
        genPoll.start();
      } catch (_) {}
    } else if (act === "clear") {
      await call("PUT", `/api/participants/${ENC(did)}`, { avatar_data_url: null, avatar_end_data_url: null });
      toast("Аватарки прибрано", "ok");
      await loaders.participants();
    } else if (act === "del") {
      if (!await confirmModal({ title: "Видалити учасника?", message: `«${p.custom_name || p.original_name}» буде видалено назавжди.`, okText: "Видалити", danger: true })) return;
      await call("DELETE", `/api/participants/${ENC(did)}?hard=1`);
      toast("Видалено", "ok");
      await loaders.participants();
    }
  });
}

$("#p-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !pendingUpload) return;
  const dataUrl = await fileToDataUrl(file);
  await call("PUT", `/api/participants/${ENC(pendingUpload.did)}`, { avatar_data_url: dataUrl });
  toast("Фото завантажено (початок)", "ok");
  pendingUpload = null;
  e.target.value = "";
  await loaders.participants();
});

$("#p-add").addEventListener("click", async () => {
  const name = await promptModal({ title: "Новий учасник", label: "Імʼя учасника", placeholder: "напр. Олег", okText: "Додати" });
  if (!name || !name.trim()) return;
  await call("POST", "/api/participants", { custom_name: name.trim() });
  toast("Додано", "ok");
  await loaders.participants();
});
$("#p-refresh").addEventListener("click", () => loaders.participants());

// ════════════════════════════════════════════════════════════════════════════
// ГЕНЕРАЦІЇ
// ════════════════════════════════════════════════════════════════════════════
const genPoll = (() => {
  let timer = null, active = false;
  async function tick() {
    if (!active) return;
    await loaders.generations();
  }
  return {
    start() { if (timer) return; active = true; tick(); timer = setInterval(tick, 2500); },
    stop() { active = false; if (timer) { clearInterval(timer); timer = null; } },
  };
})();

function genStatsRow(list) {
  const done = list.filter(g => g.status === "done").length;
  const pend = list.filter(g => g.status === "pending").length;
  const err = list.filter(g => g.status === "error").length;
  const cost = list.reduce((a, g) => a + (Number(g.cost_usd) || 0), 0);
  return [
    statCard("Усього", list.length, "", "accent"),
    statCard("Готово", done, "", "ok"),
    statCard("В обробці", pend),
    statCard("Помилок", err, "", err ? "err" : ""),
    statCard("Сума", `$${cost.toFixed(5)}`),
  ].join("");
}

function genCard(g) {
  const isErr = g.status === "error";
  const isEmptyImage = isErr && /image_url|не повернула зображення/.test(g.error || "");
  const badge = g.status === "done" ? `<span class="badge done">готово</span>`
    : isEmptyImage ? `<span class="badge pending">порожньо — повтори</span>`
    : isErr ? `<span class="badge err">помилка</span>`
    : `<span class="badge pending">в обробці</span>`;
  const resultImg = g.has_image ? `<img src="/api/generation-image/${g.id}?t=${Date.now()}">` : "";
  // Якщо є заморожений оригінал — показуємо «оригінал → результат» поруч.
  const preview = g.has_input
    ? `<div class="gen-compare">
         <figure class="gen-shot"><figcaption>оригінал</figcaption>
           <div class="preview sm" data-gact="open-input"><img src="/api/generation-input/${g.id}?t=${Date.now()}"></div></figure>
         <span class="msym gen-arrow">arrow_forward</span>
         <figure class="gen-shot"><figcaption>результат</figcaption>
           <div class="preview sm" data-gact="open">${resultImg}</div></figure>
       </div>`
    : `<div class="preview" data-gact="open">${resultImg}</div>`;
  const meta = [g.model, g.provider, g.service_tier, g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : ""].filter(Boolean).join(" · ");
  const body = g.status === "pending"
    ? `<div class="loader-bar"></div>`
    : isErr ? `<div class="original">${escapeHtml(g.error || "")}</div>`
    : `<div class="original">${escapeHtml(meta)}</div>`;
  const actions = (g.status === "done" && g.has_image) ? `
    <div class="row">
      <button class="gen-btn" data-gact="split"><span class="msym sm">content_cut</span> Розрізати</button>
      <button class="gen-btn" data-gact="regen" title="нова картинка з того ж оригіналу й промту"><span class="msym sm">autorenew</span> Перегенерувати</button>
      <button class="iconbtn btn-sm danger" data-gact="del" title="видалити"><span class="msym sm">delete</span></button>
    </div>`
    : isErr ? `
    <div class="row">
      <button class="gen-btn" data-gact="regen"><span class="msym sm">autorenew</span> Повторити</button>
      <button class="iconbtn btn-sm danger" data-gact="del" title="видалити"><span class="msym sm">delete</span></button>
    </div>`
    : "";
  return `<div class="slot" data-gid="${g.id}" data-pid="${escapeHtml(g.participant_id || "")}">
    <div class="queue-head"><strong>${escapeHtml(g.participant_name || "—")}</strong>${badge}</div>
    ${preview}
    ${body}
    ${actions}
  </div>`;
}

loaders.generations = async () => {
  const status = $("#g-filter-status").value;
  const list = await call("GET", "/api/generations" + (status ? `?status=${status}` : ""));
  $("#g-stats").innerHTML = genStatsRow(list);
  $("#g-gallery").innerHTML = list.map(genCard).join("");
  $("#g-empty").hidden = list.length > 0;
  $("#g-del-errors").hidden = !list.some(g => g.status === "error");
  $("#g-del-done").hidden = !list.some(g => g.status === "done");
  $("#g-del-all").hidden = list.length === 0;
  list.forEach(g => wireGenCard(g));
  // авто-стоп опитування коли нічого не крутиться
  if (!list.some(g => g.status === "pending")) genPoll.stop();
};

function wireGenCard(g) {
  const card = $(`#g-gallery .slot[data-gid="${g.id}"]`);
  if (!card) return;
  card.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-gact]");
    if (!t) return;
    const act = t.dataset.gact;
    if (act === "open") return openGenModal(g);
    if (act === "open-input") return openImageModal(`Оригінал — ${g.participant_name || "#" + g.id}`, `/api/generation-input/${g.id}?t=${Date.now()}`);
    if (act === "del") { await call("DELETE", `/api/generations/${g.id}`); toast("Видалено", "ok"); return loaders.generations(); }
    if (act === "regen") { const r = await call("POST", `/api/generations/${g.id}/regenerate`); toast(`Перегенерація #${r.id} — з того ж оригіналу`, "ok"); genPoll.start(); return; }
    if (act === "split") return approveSplit(g);
  });
}

async function approveSplit(g) {
  if (!g.participant_id) { toast("Генерація не привʼязана до учасника", "err"); return; }
  const { left, right, split } = await splitCollage(`/api/generation-image/${g.id}?t=${Date.now()}`);
  await call("PUT", `/api/participants/${ENC(g.participant_id)}`, { avatar_data_url: left, avatar_end_data_url: right });
  await call("DELETE", `/api/generations/${g.id}`);
  toast(split === "vertical" ? "Розрізано: верх→початок, низ→кінець" : "Розрізано: ліве→початок, праве→кінець", "ok");
  await loaders.generations();
}

$("#g-refresh").addEventListener("click", () => loaders.generations());
$("#g-filter-status").addEventListener("change", () => loaders.generations());
async function bulkDel(scope, label) {
  if (!await confirmModal({ title: "Підтвердь видалення", message: `Видалити ${label}?`, okText: "Видалити", danger: true })) return;
  const r = await call("POST", "/api/generations/bulk-delete", { scope });
  toast(`Видалено: ${r.deleted}`, "ok");
  await loaders.generations();
}
$("#g-del-errors").addEventListener("click", () => bulkDel("error", "усі генерації-помилки"));
$("#g-del-done").addEventListener("click", () => bulkDel("done", "усі готові генерації"));
$("#g-del-all").addEventListener("click", () => bulkDel("all", "ВСЮ чергу генерацій"));

// ─── модалка генерації ──────────────────────────────────────────────────────
const modalBg = $("#modal-bg");
/** Просте модальне вікно для одного зображення (оригінал генерації тощо). */
function openImageModal(title, src) {
  $("#modal-title").textContent = title;
  $("#modal-preview").innerHTML = `<img src="${src}">`;
  $("#modal-meta").innerHTML = "";
  const acts = $("#modal-actions");
  acts.innerHTML = "";
  const b = document.createElement("button");
  b.textContent = "Закрити";
  b.className = "secondary";
  b.onclick = () => modalBg.classList.remove("show");
  acts.appendChild(b);
  modalBg.classList.add("show");
}
function openGenModal(g) {
  $("#modal-title").textContent = "Перегляд генерації";
  $("#modal-preview").innerHTML = g.has_image
    ? `<img src="/api/generation-image/${g.id}?t=${Date.now()}">`
    : `<div style="padding:20px;color:var(--muted)">Зображення немає</div>`;
  $("#modal-meta").innerHTML = [
    `<span>модель: ${escapeHtml(g.model)}</span>`,
    `<span>провайдер: ${escapeHtml(g.provider)}</span>`,
    `<span>тариф: ${escapeHtml(g.service_tier)}</span>`,
    g.cost_usd != null ? `<span>$${Number(g.cost_usd).toFixed(5)}</span>` : "",
    g.prompt_tokens ? `<span>tokens in: ${g.prompt_tokens}</span>` : "",
    g.output_tokens ? `<span>tokens out: ${g.output_tokens}</span>` : "",
  ].filter(Boolean).join("");
  const acts = $("#modal-actions");
  acts.innerHTML = "";
  const close = () => modalBg.classList.remove("show");
  const mk = (label, cls, fn) => { const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; acts.appendChild(b); };
  mk("Закрити", "secondary", close);
  mk("Видалити", "reject", async () => { await call("DELETE", `/api/generations/${g.id}`); close(); loaders.generations(); });
  if (g.status === "done" && g.has_image) {
    if (g.participant_id) {
      mk("→ Початок", "secondary", async () => { await call("POST", `/api/generations/${g.id}/approve`, { which: "start" }); close(); toast("Прийнято як аватар (початок)", "ok"); loaders.generations(); loaders.participants(); });
      mk("→ Кінець", "secondary", async () => { await call("POST", `/api/generations/${g.id}/approve`, { which: "end" }); close(); toast("Прийнято як аватар (кінець)", "ok"); loaders.generations(); loaders.participants(); });
      mk("Розрізати (початок + кінець)", "", async () => { await approveSplit(g); close(); loaders.participants(); });
    }
  } else if (g.status === "error") {
    mk("Повторити", "", async () => { await call("POST", `/api/generations/${g.id}/regenerate`); close(); genPoll.start(); });
  }
  modalBg.classList.add("show");
}
modalBg.addEventListener("click", e => { if (e.target === modalBg) modalBg.classList.remove("show"); });

// ════════════════════════════════════════════════════════════════════════════
// СКРІНИ (headless Chrome)
// ════════════════════════════════════════════════════════════════════════════
let shotCapturing = false;

function shotStatsRow(list) {
  const start = list.filter(s => s.which !== "end").length;
  const end = list.filter(s => s.which === "end").length;
  return [
    statCard("Усього", list.length, "", "accent"),
    statCard("Початок", start, "", "ok"),
    statCard("Кінець", end),
  ].join("");
}

function shotCard(s) {
  const whichLabel = s.which === "end" ? "кінець" : "початок";
  const badge = `<span class="badge ${s.which === "end" ? "pending" : "done"}">${whichLabel}</span>`;
  const sub = [s.created_at, fmtBytes(s.size_bytes), s.meeting_code, s.label].filter(Boolean).map(escapeHtml).join(" · ");
  return `<div class="slot shot-card" data-sid="${s.id}">
    <div class="queue-head"><strong>#${s.id}</strong>${badge}<span class="muted mono" style="margin-left:auto">${s.width}×${s.height}</span></div>
    <div class="preview" data-sact="open"><img src="/api/screenshot-image/${s.id}?t=${Date.now()}" loading="lazy"></div>
    <div class="original">${sub}</div>
    <div class="row">
      <button class="gen-btn" data-sact="dl"><span class="msym sm">download</span> Завантажити</button>
      <button class="iconbtn btn-sm" data-sact="open" title="збільшити"><span class="msym sm">zoom_in</span></button>
      <button class="iconbtn btn-sm danger" data-sact="del" title="видалити"><span class="msym sm">delete</span></button>
    </div>
  </div>`;
}

loaders.screenshots = async () => {
  const list = await call("GET", "/api/screenshots");
  $("#sh-stats").innerHTML = shotStatsRow(list);
  $("#sh-gallery").innerHTML = list.map(shotCard).join("");
  const shEnd = list.filter(s => s.which === "end").length, shStart = list.length - shEnd;
  $("#sh-del-start").hidden = shStart === 0;
  $("#sh-del-end").hidden = shEnd === 0;
  $("#sh-del-all").hidden = list.length === 0;
  list.forEach(s => wireShotCard(s));
};

function wireShotCard(s) {
  const card = $(`#sh-gallery .slot[data-sid="${s.id}"]`);
  if (!card) return;
  card.addEventListener("click", async (ev) => {
    const t = ev.target.closest("[data-sact]");
    if (!t) return;
    const act = t.dataset.sact;
    if (act === "open") return openShotModal(s);
    if (act === "dl") { location.href = `/api/screenshot-image/${s.id}?download=1`; return; }
    if (act === "del") { await call("DELETE", `/api/screenshots/${s.id}`); toast("Видалено", "ok"); return loaders.screenshots(); }
  });
}

function shotSize() {
  const [w, h] = ($("#sh-size").value || "1280x720").split("x").map(Number);
  return { width: w || 1280, height: h || 720 };
}

async function captureShot(which) {
  if (shotCapturing) return;
  shotCapturing = true;
  const btns = [$("#sh-cap-start"), $("#sh-cap-end")];
  btns.forEach(b => b.disabled = true);
  const { width, height } = shotSize();
  toast(`Роблю скрін (${which === "end" ? "кінець" : "початок"}, ${width}×${height})…`);
  try {
    const r = await call("POST", "/api/screenshots", { which, width, height });
    toast(`Скрін #${r.id} готовий (${fmtBytes(r.size_bytes)})`, "ok");
    await loaders.screenshots();
  } catch (_) {
    /* помилку вже показав toast у call() */
  } finally {
    shotCapturing = false;
    btns.forEach(b => b.disabled = false);
  }
}

function openShotModal(s) {
  $("#modal-title").textContent = `Скрін #${s.id} — ${s.which === "end" ? "кінець" : "початок"}`;
  $("#modal-preview").innerHTML = `<img src="/api/screenshot-image/${s.id}?t=${Date.now()}">`;
  $("#modal-meta").innerHTML = [
    `<span>${s.width}×${s.height}</span>`,
    `<span>${fmtBytes(s.size_bytes)}</span>`,
    s.meeting_code ? `<span>код: ${escapeHtml(s.meeting_code)}</span>` : "",
    s.created_at ? `<span>${escapeHtml(s.created_at)}</span>` : "",
  ].filter(Boolean).join("");
  const acts = $("#modal-actions");
  acts.innerHTML = "";
  const close = () => modalBg.classList.remove("show");
  const mk = (label, cls, fn) => { const b = document.createElement("button"); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; acts.appendChild(b); };
  mk("Закрити", "secondary", close);
  mk("Завантажити", "", () => location.href = `/api/screenshot-image/${s.id}?download=1`);
  mk("Видалити", "reject", async () => { await call("DELETE", `/api/screenshots/${s.id}`); close(); toast("Видалено", "ok"); loaders.screenshots(); });
  modalBg.classList.add("show");
}

async function shotBulkDel(scope, label) {
  if (!await confirmModal({ title: "Підтвердь видалення", message: `Видалити ${label}?`, okText: "Видалити", danger: true })) return;
  const r = await call("POST", "/api/screenshots/bulk-delete", { scope });
  toast(`Видалено: ${r.deleted}`, "ok");
  await loaders.screenshots();
}

$("#sh-cap-start").addEventListener("click", () => captureShot("start"));
$("#sh-cap-end").addEventListener("click", () => captureShot("end"));
$("#sh-refresh").addEventListener("click", () => loaders.screenshots());
$("#sh-del-start").addEventListener("click", () => shotBulkDel("start", "усі скріни «початок»"));
$("#sh-del-end").addEventListener("click", () => shotBulkDel("end", "усі скріни «кінець»"));
$("#sh-del-all").addEventListener("click", () => shotBulkDel("all", "ВСЮ історію скрінів"));

// ════════════════════════════════════════════════════════════════════════════
// НАЛАШТУВАННЯ
// ════════════════════════════════════════════════════════════════════════════
function parseTime(str) {
  const m = String(str).trim().match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
  return m ? { time: m[1], period: m[2].toUpperCase() } : null;
}
function wireTimePicker(el, timeKey, periodKey, display) {
  el.value = display;
  flatpickr(el, {
    enableTime: true, noCalendar: true, dateFormat: "h:i K", time_24hr: false,
    defaultDate: display, allowInput: false,
    onChange: async (_, str) => {
      const p = parseTime(str); if (!p) return;
      await call("PUT", "/api/settings", { [timeKey]: p.time, [periodKey]: p.period });
      toast("Збережено", "ok");
    },
  });
}
let settingsWired = false;
loaders.settings = async () => {
  const s = await call("GET", "/api/settings");
  $("#s-code").value = s.meeting_code || "";
  if (!settingsWired) {
    wireTimePicker($("#s-start"), "start_time", "start_period", `${s.start_time || "10:34"} ${s.start_period || "PM"}`);
    wireTimePicker($("#s-end"), "end_time", "end_period", `${s.end_time || "11:15"} ${s.end_period || "PM"}`);
    settingsWired = true;
  }
  if (s.gen_model && [...$("#s-model").options].some(o => o.value === s.gen_model)) $("#s-model").value = s.gen_model;
  if (s.gen_provider) $("#s-provider").value = s.gen_provider;
  if (s.gen_tier) $("#s-tier").value = s.gen_tier;
  const key = $("#s-key");
  if (s.openrouter_api_key_set) { key.value = ""; key.placeholder = "•••••• (з .env або БД)"; key.readOnly = true; key.style.opacity = ".6"; }
  else { key.placeholder = "sk-or-..."; key.readOnly = false; key.style.opacity = ""; }
};
$("#s-code").addEventListener("change", e => call("PUT", "/api/settings", { meeting_code: e.target.value }).then(() => toast("Збережено", "ok")));
$("#s-gen-code").addEventListener("click", async () => {
  const code = randomMeetingCode();
  $("#s-code").value = code;
  await call("PUT", "/api/settings", { meeting_code: code });
  toast("Згенеровано: " + code, "ok");
});
$("#s-model").addEventListener("change", e => call("PUT", "/api/settings", { gen_model: e.target.value }).then(() => toast("Збережено", "ok")));
$("#s-provider").addEventListener("change", e => call("PUT", "/api/settings", { gen_provider: e.target.value }).then(() => toast("Збережено", "ok")));
$("#s-tier").addEventListener("change", e => call("PUT", "/api/settings", { gen_tier: e.target.value }).then(() => toast("Збережено", "ok")));
$("#s-key").addEventListener("change", async e => {
  const v = e.target.value.trim();
  if (!v) return;
  if (!v.startsWith("sk-or-")) { toast("Ключ має починатись з sk-or-…", "err"); return; }
  await call("PUT", "/api/settings", { openrouter_api_key: v });
  e.target.value = ""; e.target.placeholder = "•••••• (збережено)"; e.target.readOnly = true;
  toast("Ключ збережено", "ok");
});
$("#s-balance-refresh").addEventListener("click", async () => {
  $("#s-balance").textContent = "…";
  try {
    const d = await api("GET", "/api/credits");
    const data = d.data || d;
    const left = Number(data.total_credits ?? 0) - Number(data.total_usage ?? 0);
    $("#s-balance").textContent = `$${left.toFixed(4)}`;
  } catch (e) { $("#s-balance").textContent = "—"; toast(e.message, "err"); }
});

// ════════════════════════════════════════════════════════════════════════════
// ПРОМТ + ПРЕСЕТИ
// ════════════════════════════════════════════════════════════════════════════
loaders.prompt = async () => {
  const r = await call("GET", "/api/prompt");
  $("#pr-text").value = r.prompt || "";
  await loadPresets();
};
async function loadPresets() {
  const list = await call("GET", "/api/prompt/presets");
  const tb = $("#pr-presets tbody");
  tb.innerHTML = list.map(p =>
    `<tr data-pid="${p.id}"><td>${escapeHtml(p.name)}</td><td class="muted">${escapeHtml(p.updated_at || "")}</td>
     <td><div class="flex" style="gap:4px"><button class="iconbtn btn-sm" data-pact="load"><span class="msym sm">download</span>Завантажити</button><button class="iconbtn btn-sm danger" data-pact="del"><span class="msym sm">delete</span></button></div></td></tr>`
  ).join("");
  $("#pr-presets-empty").hidden = list.length > 0;
  tb.querySelectorAll("tr").forEach(tr => {
    const id = tr.dataset.pid;
    const preset = list.find(x => String(x.id) === String(id));
    tr.addEventListener("click", async ev => {
      const b = ev.target.closest("button[data-pact]"); if (!b) return;
      if (b.dataset.pact === "load") { $("#pr-text").value = preset.body; toast(`Завантажено «${preset.name}» (не забудь «Зберегти промт»)`, "ok"); }
      else if (b.dataset.pact === "del") { await call("DELETE", `/api/prompt/presets/${id}`); toast("Видалено", "ok"); loadPresets(); }
    });
  });
}
$("#pr-save").addEventListener("click", async () => { await call("PUT", "/api/prompt", { prompt: $("#pr-text").value }); toast("Промт збережено у promt.md", "ok"); });
$("#pr-preset-save").addEventListener("click", async () => {
  const name = $("#pr-preset-name").value.trim();
  if (!name) { toast("Вкажи назву пресета", "err"); return; }
  await call("POST", "/api/prompt/presets", { name, body: $("#pr-text").value });
  $("#pr-preset-name").value = "";
  toast("Пресет збережено", "ok");
  loadPresets();
});

// ─── init ─────────────────────────────────────────────────────────────────
const startTab = (location.hash || "#participants").slice(1);
activateTab(["participants", "generations", "screenshots", "settings", "prompt"].includes(startTab) ? startTab : "participants");
