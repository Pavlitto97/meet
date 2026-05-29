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

// ════════════════════════════════════════════════════════════════════════════
// ОГЛЯД
// ════════════════════════════════════════════════════════════════════════════
function statCard(label, value, sub = "", cls = "") {
  return `<div class="stat-card ${cls}"><span class="label">${escapeHtml(label)}</span>` +
         `<span class="value">${value}</span>` +
         (sub ? `<span class="sub">${escapeHtml(sub)}</span>` : "") + `</div>`;
}
loaders.dashboard = async () => {
  const s = await call("GET", "/api/admin/stats");
  const p = s.participants, g = s.generations;
  $("#stat-grid").innerHTML = [
    statCard("Учасників", p.total, `${p.editable} активних · ${p.skipped} пропущено`, "accent"),
    statCard("З аватаром", `${p.with_avatar}/${p.editable}`, `${p.with_avatar_end} мають кінцеву`),
    statCard("Імена задані", `${p.named}`, `додано вручну: ${p.user_added}`),
    statCard("Генерацій", g.total, `done ${g.done} · err ${g.error} · pend ${g.pending}`, g.error ? "warn" : "ok"),
    statCard("Витрачено", `$${Number(g.total_cost).toFixed(4)}`, "OpenRouter"),
    statCard("Скрінів", (s.screenshots && s.screenshots.total) || 0, `поч ${(s.screenshots && s.screenshots.starts) || 0} · кін ${(s.screenshots && s.screenshots.ends) || 0}`),
    statCard("Розмір БД", fmtBytes(s.db_size_bytes), `${s.presets} пресетів`),
    statCard("Код зустрічі", `<span class="mono" style="font-size:18px">${escapeHtml(s.settings.meeting_code || "—")}</span>`, `${s.settings.start} → ${s.settings.end}`),
    statCard("API ключ", s.settings.api_key_set ? "✓ задано" : "✗ немає", s.settings.gen_model, s.settings.api_key_set ? "ok" : "err"),
  ].join("");
  const tb = $("#cost-table tbody");
  tb.innerHTML = (s.cost_by_model || []).map(m =>
    `<tr><td class="mono">${escapeHtml(m.model)}</td><td>${m.n}</td><td>$${Number(m.cost).toFixed(5)}</td></tr>`
  ).join("") || `<tr><td colspan="3" class="muted">немає даних</td></tr>`;
};
$("#dash-refresh").addEventListener("click", () => loaders.dashboard());
$("#dash-preview-start").addEventListener("click", () => window.open("/api/render?which=start&t=" + Date.now(), "meet-start"));
$("#dash-preview-end").addEventListener("click", () => window.open("/api/render?which=end&t=" + Date.now(), "meet-end"));
$("#dash-dl-start").addEventListener("click", () => location.href = "/api/render?which=start&download=1");
$("#dash-dl-end").addEventListener("click", () => location.href = "/api/render?which=end&download=1");

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
  const up = idx > 0 ? `<button class="iconbtn btn-sm" data-act="up" title="вище">↑</button>` : `<span style="display:inline-block;width:28px"></span>`;
  const down = idx < total - 1 ? `<button class="iconbtn btn-sm" data-act="down" title="нижче">↓</button>` : "";
  const tags = (p.user_added ? `<span class="badge user">вручну</span> ` : "");
  return `<tr data-id="${escapeHtml(p.device_id)}" class="${p.skipped ? "skipped" : ""}">
    <td><div class="flex" style="gap:2px">${up}${down}<span class="muted mono">${p.position}</span></div></td>
    <td><div class="flex" style="gap:6px">${thumb(p, "start")}${thumb(p, "end")}</div></td>
    <td><input class="i-name" value="${escapeHtml(p.custom_name || "")}" placeholder="${escapeHtml(p.original_name || "")}">${tags ? "<div style='margin-top:4px'>" + tags + "</div>" : ""}</td>
    <td><input class="i-orig mono" value="${escapeHtml(p.original_name || "")}" title="оригінальний рядок у HTML — заміняється на custom"></td>
    <td style="text-align:center"><input type="checkbox" class="i-skip" ${p.skipped ? "checked" : ""}></td>
    <td><div class="flex" style="gap:4px">
      <button class="iconbtn btn-sm" data-act="upload" title="завантажити фото (початок)">⤒</button>
      <button class="iconbtn btn-sm" data-act="gen" ${p.skipped ? "disabled" : ""} title="згенерувати AI-колаж">✨</button>
      <button class="iconbtn btn-sm" data-act="clear" title="прибрати аватарки">×</button>
      ${p.user_added ? `<button class="iconbtn btn-sm danger" data-act="del" title="видалити">🗑</button>` : ""}
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
  $(".i-orig", tr).addEventListener("change", e => { if (e.target.value.trim()) save({ original_name: e.target.value }); });
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
      if (!confirm(`Видалити «${p.custom_name || p.original_name}» назавжди?`)) return;
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
  const name = prompt("Імʼя нового учасника:");
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
  const isEmptyImage = isErr && /image_url/.test(g.error || "");
  const badge = g.status === "done" ? `<span class="badge done">готово</span>`
    : isEmptyImage ? `<span class="badge pending">порожньо — повтори</span>`
    : isErr ? `<span class="badge err">помилка</span>`
    : `<span class="badge pending">в обробці</span>`;
  const img = g.has_image ? `<img src="/api/generation-image/${g.id}?t=${Date.now()}">` : "";
  const meta = [g.model, g.provider, g.service_tier, g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : ""].filter(Boolean).join(" · ");
  const body = g.status === "pending"
    ? `<div class="loader-bar"></div>`
    : isErr ? `<div class="original">${escapeHtml(g.error || "")}</div>`
    : `<div class="original">${escapeHtml(meta)}</div>`;
  const actions = (g.status === "done" && g.has_image) ? `
    <div class="row"><button class="gen-btn" data-gact="split">✂ Розрізати</button><button class="iconbtn btn-sm" data-gact="open">🔍</button><button class="iconbtn btn-sm danger" data-gact="del">🗑</button></div>`
    : isErr ? `<div class="row"><button class="gen-btn" data-gact="regen">↻ Повторити</button><button class="iconbtn btn-sm danger" data-gact="del">🗑</button></div>`
    : "";
  return `<div class="slot" data-gid="${g.id}" data-pid="${escapeHtml(g.participant_id || "")}">
    <div class="queue-head"><strong>${escapeHtml(g.participant_name || "—")}</strong>${badge}</div>
    <div class="preview" data-gact="open">${img}</div>
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
    if (act === "del") { await call("DELETE", `/api/generations/${g.id}`); toast("Видалено", "ok"); return loaders.generations(); }
    if (act === "regen") { const r = await call("POST", `/api/generations/${g.id}/regenerate`); toast(`Повтор #${r.id}`, "ok"); genPoll.start(); return; }
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
  if (!confirm(`Видалити ${label}?`)) return;
  const r = await call("POST", "/api/generations/bulk-delete", { scope });
  toast(`Видалено: ${r.deleted}`, "ok");
  await loaders.generations();
}
$("#g-del-errors").addEventListener("click", () => bulkDel("error", "усі генерації-помилки"));
$("#g-del-done").addEventListener("click", () => bulkDel("done", "усі готові генерації"));
$("#g-del-all").addEventListener("click", () => bulkDel("all", "ВСЮ чергу генерацій"));

// ─── модалка генерації ──────────────────────────────────────────────────────
const modalBg = $("#modal-bg");
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
  mk("🗑 Видалити", "reject", async () => { await call("DELETE", `/api/generations/${g.id}`); close(); loaders.generations(); });
  if (g.status === "done" && g.has_image) {
    if (g.participant_id) {
      mk("→ Початок", "secondary", async () => { await call("POST", `/api/generations/${g.id}/approve`, { which: "start" }); close(); toast("Прийнято як аватар (початок)", "ok"); loaders.generations(); loaders.participants(); });
      mk("→ Кінець", "secondary", async () => { await call("POST", `/api/generations/${g.id}/approve`, { which: "end" }); close(); toast("Прийнято як аватар (кінець)", "ok"); loaders.generations(); loaders.participants(); });
      mk("✂ Розрізати (поч+кін)", "", async () => { await approveSplit(g); close(); loaders.participants(); });
    }
  } else if (g.status === "error") {
    mk("↻ Повторити", "", async () => { await call("POST", `/api/generations/${g.id}/regenerate`); close(); genPoll.start(); });
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
  const bytes = list.reduce((a, s) => a + (Number(s.size_bytes) || 0), 0);
  return [
    statCard("Усього", list.length, "", "accent"),
    statCard("Початок", start, "", "ok"),
    statCard("Кінець", end),
    statCard("Обсяг", fmtBytes(bytes)),
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
      <button class="gen-btn" data-sact="dl">⤓ Завантажити</button>
      <button class="iconbtn btn-sm" data-sact="open" title="збільшити">🔍</button>
      <button class="iconbtn btn-sm danger" data-sact="del" title="видалити">🗑</button>
    </div>
  </div>`;
}

loaders.screenshots = async () => {
  const list = await call("GET", "/api/screenshots");
  $("#sh-stats").innerHTML = shotStatsRow(list);
  $("#sh-gallery").innerHTML = list.map(shotCard).join("");
  $("#sh-empty").hidden = list.length > 0;
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
  mk("⤓ Завантажити", "", () => location.href = `/api/screenshot-image/${s.id}?download=1`);
  mk("🗑 Видалити", "reject", async () => { await call("DELETE", `/api/screenshots/${s.id}`); close(); toast("Видалено", "ok"); loaders.screenshots(); });
  modalBg.classList.add("show");
}

async function shotBulkDel(scope, label) {
  if (!confirm(`Видалити ${label}?`)) return;
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
     <td><div class="flex" style="gap:4px"><button class="iconbtn btn-sm" data-pact="load">↧ Завантажити</button><button class="iconbtn btn-sm danger" data-pact="del">🗑</button></div></td></tr>`
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

// ════════════════════════════════════════════════════════════════════════════
// СИСТЕМА
// ════════════════════════════════════════════════════════════════════════════
function kv(obj) { return Object.entries(obj).map(([k, v]) => `<span class="k">${escapeHtml(k)}</span><span>${v}</span>`).join(""); }
loaders.system = async () => { await Promise.all([loadSystem(), loadDbInfo(), loadActivity()]); };
async function loadSystem() {
  const s = await call("GET", "/api/admin/system");
  $("#sys-info").innerHTML = kv({
    "index.html": s.index_html.present ? `✓ ${fmtBytes(s.index_html.size)} · ${s.index_html.participant_ids} participant-id` : "✗ відсутній",
    "index.html.bak": s.index_bak.present ? `✓ ${fmtBytes(s.index_bak.size)}` : "✗ відсутній",
    "Chrome (скріни)": s.chrome && s.chrome.available ? `✓ <span class="mono">${escapeHtml(s.chrome.path)}</span>` : "✗ не знайдено (скріни недоступні)",
    "assets": `${s.assets.fonts} шрифтів · ${s.assets.img} зобр · ${s.assets.emoji} emoji`,
    "PHP": escapeHtml(s.php),
    "Платформа": escapeHtml(s.platform),
    "Порт": s.port,
    "Uptime": fmtDuration(s.uptime_seconds),
  });
}
async function loadDbInfo() {
  const d = await call("GET", "/api/admin/db");
  const rows = Object.entries(d.rows).map(([t, n]) => `${t}: ${n ?? "—"}`).join(" · ");
  $("#db-info").innerHTML = kv({
    "Файл": `<span class="mono">data.db</span> · ${fmtBytes(d.size_bytes)}`,
    "Таблиці": rows,
    "Сторінки": `${d.page_count} × ${fmtBytes(d.page_size)} (вільних: ${d.freelist_count})`,
  });
}
async function loadActivity() {
  const list = await call("GET", "/api/admin/activity?limit=100");
  $("#activity-log").innerHTML = list.map(a =>
    `<div class="row-log"><span class="ts mono">${escapeHtml(a.ts || "")}</span><span class="act">${escapeHtml(a.action)}</span><span>${escapeHtml(a.detail || "")}</span></div>`
  ).join("") || `<div class="row-log muted">журнал порожній</div>`;
}
$("#sys-refresh").addEventListener("click", loadSystem);
$("#act-refresh").addEventListener("click", loadActivity);
$("#db-backup").addEventListener("click", () => location.href = "/api/admin/backup");
$("#db-vacuum").addEventListener("click", async () => {
  const r = await call("POST", "/api/admin/db/vacuum", {});
  toast(`VACUUM ок — ${fmtBytes(r.size_bytes)}`, "ok");
  loadDbInfo();
});
$("#db-reset").addEventListener("click", async () => {
  const c = prompt("Це СКИНЕ всю базу (учасники, аватарки, генерації) до дефолтів.\nВведи RESET щоб підтвердити:");
  if (c !== "RESET") { if (c !== null) toast("Скасовано — введи рівно RESET", "err"); return; }
  await call("POST", "/api/admin/db/reset", { confirm: "RESET" });
  toast("Базу скинуто", "ok");
  await loaders.system(); await loaders.dashboard();
});
$("#idx-restore").addEventListener("click", async () => {
  const c = prompt("Відновити index.html з index.html.bak (перезапише поточний).\nВведи RESTORE щоб підтвердити:");
  if (c !== "RESTORE") { if (c !== null) toast("Скасовано — введи рівно RESTORE", "err"); return; }
  const r = await call("POST", "/api/admin/restore-index", { confirm: "RESTORE" });
  toast(`index.html відновлено — ${fmtBytes(r.size_bytes)}`, "ok");
  loadSystem();
});
$("#imp-btn").addEventListener("click", () => $("#imp-file").click());
$("#imp-file").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  if (!confirm("Імпорт перезапише налаштування, промт, пресети й аватарки з файлу. Продовжити?")) { e.target.value = ""; return; }
  try {
    const data = JSON.parse(await file.text());
    const r = await call("POST", "/api/admin/import", data);
    toast(`Імпорт: учасники +${r.participants_created}/~${r.participants_updated}, пресети ${r.presets}, налашт. ${r.settings}`, "ok");
    await loaders.system(); await loaders.dashboard();
  } catch (err) { toast("Помилка імпорту: " + err.message, "err"); }
  e.target.value = "";
});

// ─── init ─────────────────────────────────────────────────────────────────
const startTab = (location.hash || "#dashboard").slice(1);
activateTab(["dashboard", "participants", "generations", "screenshots", "settings", "prompt", "system"].includes(startTab) ? startTab : "dashboard");
