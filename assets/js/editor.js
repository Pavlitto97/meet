/* Логіка редактора Meet. Спільні утиліти — в api.js (підключається раніше). */
const statusEl = document.getElementById("status");
const grid = document.getElementById("grid");
const previewStartBtn = document.getElementById("preview-start");
const previewEndBtn = document.getElementById("preview-end");
const saveStartBtn = document.getElementById("save-start");
const saveEndBtn = document.getElementById("save-end");
const setStatus = makeStatus(statusEl);
let previewWins = { start: null, end: null };

// ─── налаштування зустрічі ─────────────────────────────────────────
const codeInput = document.getElementById("f-code");
const startInput = document.getElementById("f-start-time");
const endInput = document.getElementById("f-end-time");

function parseTimeString(str) {
  // "10:34 PM" → { time: "10:34", period: "PM" }
  const m = String(str).trim().match(/^(\d{1,2}:\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  return { time: m[1], period: m[2].toUpperCase() };
}

function wireTimePicker(inputEl, timeKey, periodKey, defaultDisplay) {
  inputEl.value = defaultDisplay;
  flatpickr(inputEl, {
    enableTime: true,
    noCalendar: true,
    dateFormat: "h:i K",     // 12-год + AM/PM
    time_24hr: false,
    defaultDate: defaultDisplay,
    allowInput: false,
    onChange: async (_, dateStr) => {
      const parsed = parseTimeString(dateStr);
      if (!parsed) return;
      try {
        await api("PUT", "/api/settings", { [timeKey]: parsed.time, [periodKey]: parsed.period });
        setStatus("Збережено", "ok");
      } catch (e) { setStatus(e.message, "err"); }
    },
  });
}

async function loadSettings(preloaded) {
  const s = preloaded || await api("GET", "/api/settings");
  codeInput.value = s.meeting_code || "";
  wireTimePicker(startInput, "start_time", "start_period",
                 `${s.start_time || "10:34"} ${s.start_period || "PM"}`);
  wireTimePicker(endInput, "end_time", "end_period",
                 `${s.end_time || "11:15"} ${s.end_period || "PM"}`);
}

codeInput.addEventListener("change", async () => {
  try {
    await api("PUT", "/api/settings", { meeting_code: codeInput.value });
    setStatus("Збережено", "ok");
  } catch (e) { setStatus(e.message, "err"); }
});

document.getElementById("gen-code").addEventListener("click", async () => {
  const code = randomMeetingCode();
  codeInput.value = code;
  try {
    await api("PUT", "/api/settings", { meeting_code: code });
    setStatus("Згенеровано: " + code, "ok");
  } catch (e) { setStatus(e.message, "err"); }
});

// ─── учасники ──────────────────────────────────────────────────────
function slotTemplate(p) {
  const skipped = p.skipped ? " skipped" : "";
  const skipTag = p.skipped ? `<span class="skip-tag">пропускаємо</span>` : "";
  const userTag = p.user_added ? `<span class="user-tag">додано вручну</span>` : "";
  const disabledAttr = p.skipped ? "disabled" : "";
  const pidEnc = encodeURIComponent(p.device_id);
  const startImg = p.has_avatar ? `<img src="/api/avatar/${pidEnc}?which=start&t=${Date.now()}">` : "";
  const endImg = p.has_avatar_end
    ? `<img src="/api/avatar/${pidEnc}?which=end&t=${Date.now()}">`
    : (p.has_avatar ? `<img src="/api/avatar/${pidEnc}?which=start&t=${Date.now()}" style="opacity:.4">` : "");
  return `
    <div class="slot${skipped}" data-id="${p.device_id}">
      ${skipTag}${userTag}
      <div class="field">
        <label>Ім'я</label>
        <input class="name-input" type="text" ${disabledAttr}>
      </div>
      <div class="avatar-pair">
        <div class="avatar-side">
          <div class="avatar-label">початок</div>
          <div class="preview preview-start">${startImg}</div>
        </div>
        <div class="avatar-side">
          <div class="avatar-label">кінець ${p.has_avatar_end ? "" : "(=початок)"}</div>
          <div class="preview preview-end">${endImg}</div>
        </div>
      </div>
      <div class="row">
        <label class="file-btn">
          ${p.has_avatar ? "Замінити початок" : "Завантажити фото"}
          <input type="file" accept="image/*" ${disabledAttr}>
        </label>
        <button type="button" class="clear-btn" ${p.has_avatar || p.has_avatar_end ? "" : "hidden"} title="Прибрати обидва фото">×</button>
      </div>
      <div class="row">
        <button type="button" class="gen-btn" ${disabledAttr} title="Згенерувати колаж і розділити на початок/кінець">✨ Згенерувати</button>
        ${p.user_added ? `<button type="button" class="del-btn" title="Видалити учасника">🗑</button>` : ""}
      </div>
      <div class="gen-status"></div>
    </div>
  `;
}

async function loadParticipants() {
  const list = await api("GET", "/api/participants");
  grid.innerHTML = list.map(slotTemplate).join("");
  for (const p of list) wireSlot(p);
}

function wireSlot(p) {
  const slot = grid.querySelector(`.slot[data-id="${cssEsc(p.device_id)}"]`);
  if (!slot) return;
  const nameInput = slot.querySelector(".name-input");
  const fileInput = slot.querySelector("input[type=file]");
  const clearBtn = slot.querySelector(".clear-btn");
  const previewStart = slot.querySelector(".preview-start");
  const previewEnd   = slot.querySelector(".preview-end");
  const fileBtn  = slot.querySelector(".file-btn");
  const genBtn   = slot.querySelector(".gen-btn");
  const delBtn   = slot.querySelector(".del-btn");

  nameInput.value = p.custom_name || "";
  nameInput.placeholder = p.original_name || "";

  nameInput.addEventListener("change", async () => {
    try {
      await api("PUT", `/api/participants/${encodeURIComponent(p.device_id)}`,
                { custom_name: nameInput.value || null });
      setStatus("Збережено", "ok");
    } catch (e) { setStatus(e.message, "err"); }
  });

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    try {
      await api("PUT", `/api/participants/${encodeURIComponent(p.device_id)}`,
                { avatar_data_url: dataUrl });
      const t = Date.now();
      previewStart.innerHTML = `<img src="/api/avatar/${encodeURIComponent(p.device_id)}?which=start&t=${t}">`;
      if (!p.has_avatar_end) {
        previewEnd.innerHTML = `<img src="/api/avatar/${encodeURIComponent(p.device_id)}?which=start&t=${t}" style="opacity:.4">`;
      }
      clearBtn.hidden = false;
      fileBtn.firstChild.textContent = " Замінити початок ";
      setStatus("Збережено", "ok");
    } catch (e2) { setStatus(e2.message, "err"); }
    fileInput.value = "";
  });

  clearBtn.addEventListener("click", async () => {
    try {
      await api("PUT", `/api/participants/${encodeURIComponent(p.device_id)}`,
                { avatar_data_url: null, avatar_end_data_url: null });
      previewStart.innerHTML = "";
      previewEnd.innerHTML = "";
      clearBtn.hidden = true;
      fileBtn.firstChild.textContent = " Завантажити фото ";
      setStatus("Прибрано", "ok");
    } catch (e) { setStatus(e.message, "err"); }
  });

  genBtn?.addEventListener("click", async () => {
    if (genBtn.disabled) return;
    genBtn.disabled = true;
    const statusLine = slot.querySelector(".gen-status");
    statusLine.className = "gen-status";
    statusLine.textContent = "Стартую…";
    slot.classList.add("busy");
    try {
      const r = await api("POST", "/api/generate", { participant_id: p.device_id });
      statusLine.textContent = `Генерація #${r.id}…`;
      ensurePolling();
    } catch (e) {
      statusLine.className = "gen-status err";
      statusLine.textContent = e.message;
      slot.classList.remove("busy");
      genBtn.disabled = false;
    }
  });

  delBtn?.addEventListener("click", async () => {
    if (!confirm(`Видалити «${nameInput.value || p.original_name}»?`)) return;
    try {
      await api("DELETE", `/api/participants/${encodeURIComponent(p.device_id)}?hard=1`);
      slot.remove();
      setStatus("Видалено", "ok");
    } catch (e) { setStatus(e.message, "err"); }
  });
}

// ─── preview / save ────────────────────────────────────────────────
function openPreview(which) {
  const url = `/api/render?which=${which}&t=${Date.now()}`;
  const w = previewWins[which];
  if (!w || w.closed) {
    previewWins[which] = window.open(url, `meet-preview-${which}`);
  } else {
    w.location.replace(url);
    w.focus();
  }
}
previewStartBtn.addEventListener("click", () => openPreview("start"));
previewEndBtn.addEventListener("click", () => openPreview("end"));
saveStartBtn.addEventListener("click", () => { window.location.href = "/api/render?which=start&download=1"; });
saveEndBtn.addEventListener("click", () => { window.location.href = "/api/render?which=end&download=1"; });

// ─── AI-панель ─────────────────────────────────────────────────────
const keyInput = document.getElementById("f-key");
const modelSel = document.getElementById("f-model");
const provSel  = document.getElementById("f-provider");
const tierSel  = document.getElementById("f-tier");
const balanceEl = document.getElementById("f-balance");
const refreshBtn = document.getElementById("refresh-balance");
const promptEl = document.getElementById("f-prompt");

async function loadAiSettings(s) {
  if (s.gen_model && [...modelSel.options].some(o => o.value === s.gen_model)) {
    modelSel.value = s.gen_model;
  }
  if (s.gen_provider) provSel.value = s.gen_provider;
  if (s.gen_tier) tierSel.value = s.gen_tier;
  if (s.openrouter_api_key_set) {
    keyInput.value = "";
    keyInput.placeholder = "•••••• (з .env або БД)";
    keyInput.readOnly = true;
    keyInput.style.opacity = ".6";
    keyInput.title = "Видали .env і перезапусти сервер, щоб ввести інший ключ";
  } else {
    keyInput.placeholder = "sk-or-...";
    keyInput.readOnly = false;
    keyInput.style.opacity = "";
  }
}

async function saveAi(key, value) {
  try {
    await api("PUT", "/api/settings", { [key]: value });
    setStatus("Збережено", "ok");
  } catch (e) { setStatus(e.message, "err"); }
}
keyInput.addEventListener("change", () => {
  const v = keyInput.value.trim();
  if (!v) return;
  if (!v.startsWith("sk-or-")) {
    setStatus("Ключ має починатись з sk-or-…", "err");
    return;
  }
  saveAi("openrouter_api_key", v);
  keyInput.value = "";
  keyInput.placeholder = "•••••• (збережено)";
  keyInput.readOnly = true;
});
modelSel.addEventListener("change", () => saveAi("gen_model", modelSel.value));
provSel.addEventListener("change",  () => saveAi("gen_provider", provSel.value));
tierSel.addEventListener("change",  () => saveAi("gen_tier", tierSel.value));

async function refreshBalance() {
  balanceEl.textContent = "…";
  try {
    const d = await api("GET", "/api/credits");
    const data = d.data || d;
    const total = Number(data.total_credits ?? 0);
    const used  = Number(data.total_usage ?? 0);
    const left  = (total - used);
    balanceEl.textContent = `$${left.toFixed(4)} (з ${total.toFixed(2)})`;
  } catch (e) {
    balanceEl.textContent = "—";
    setStatus("Баланс: " + e.message, "err");
  }
}
refreshBtn.addEventListener("click", refreshBalance);

// ─── промт ─────────────────────────────────────────────────────────
async function loadPrompt() {
  const r = await api("GET", "/api/prompt");
  promptEl.value = r.prompt || "";
}
promptEl.addEventListener("change", async () => {
  try {
    await api("PUT", "/api/prompt", { prompt: promptEl.value });
    setStatus("Промт збережено у promt.md", "ok");
  } catch (e) { setStatus(e.message, "err"); }
});

// ─── додати учасника ───────────────────────────────────────────────
document.getElementById("add-participant").addEventListener("click", async () => {
  const name = prompt("Імʼя нового учасника:");
  if (!name) return;
  try {
    await api("POST", "/api/participants", { custom_name: name.trim() });
    await loadParticipants();
    setStatus("Додано", "ok");
  } catch (e) { setStatus(e.message, "err"); }
});

// ─── черга генерацій + опитування ──────────────────────────────────
const queue = document.getElementById("queue");
const queueHeader = document.getElementById("queue-header");
let pollTimer = null;

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollGenerations, 2000);
  pollGenerations();
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function pollGenerations() {
  let list;
  try { list = await api("GET", "/api/generations"); }
  catch (e) { return; }
  for (const slot of grid.querySelectorAll(".slot")) {
    const pid = slot.getAttribute("data-id");
    const mine = list.filter(g => g.participant_id === pid);
    const pending = mine.find(g => g.status === "pending");
    const err = mine.find(g => g.status === "error");
    const statusLine = slot.querySelector(".gen-status");
    const gen = slot.querySelector(".gen-btn");
    if (!statusLine) continue;
    if (pending) {
      statusLine.className = "gen-status";
      statusLine.innerHTML =
        `<span>Зображення в обробці… #${pending.id}</span>` +
        `<div class="loader-bar"></div>`;
      slot.classList.add("busy");
      if (gen) gen.disabled = true;
    } else if (err) {
      statusLine.className = "gen-status err";
      statusLine.textContent = `Помилка: ${err.error || "невідома"}`;
      slot.classList.remove("busy");
      if (gen) gen.disabled = false;
    } else {
      if (!(statusLine.textContent || "").startsWith("Помилка")) statusLine.innerHTML = "";
      slot.classList.remove("busy");
      if (gen) gen.disabled = false;
    }
  }
  const reviewable = list.filter(g => g.status === "done" || g.status === "error");
  const grouped = new Map();
  for (const g of reviewable) {
    const key = g.participant_id || "_orphan";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(g);
  }
  const enriched = [];
  for (const arr of grouped.values()) {
    const total = arr.length;
    arr.forEach((g, i) => enriched.push({ ...g, _variantIdx: i + 1, _variantTotal: total }));
  }
  queue.innerHTML = enriched.map(queueCard).join("");
  queueHeader.hidden = enriched.length === 0;
  for (const g of enriched) wireQueueCard(g);
  if (!list.some(g => g.status === "pending")) stopPolling();
}

function queueCard(g) {
  const meta = [
    g.model, g.provider, g.service_tier,
    g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : "",
  ].filter(Boolean).join(" · ");
  const img = g.has_image ? `<img src="/api/generation-image/${g.id}?t=${Date.now()}">` : "";
  const isErr = g.status === "error";
  const isEmptyImage = isErr && /image_url/.test(g.error || "");
  const tag = isEmptyImage
    ? `<span class="user-tag">обробка</span>`
    : isErr ? `<span class="skip-tag">помилка</span>` : `<span class="user-tag">готово</span>`;
  const name = g.participant_name || "—";
  const variant = g._variantTotal > 1
    ? `<span class="variant-pill">варіант ${g._variantIdx}/${g._variantTotal}</span>`
    : "";
  const header = `<div class="queue-head"><strong>${escapeHtml(name)}</strong>${variant}</div>`;
  const bodyText = isEmptyImage
    ? `<div>Модель не повернула картинку — натисни ✨ Згенерувати ще раз</div><div class="loader-bar"></div>`
    : `<div class="original">${escapeHtml(isErr ? (g.error || "") : meta)}</div>`;
  return `
    <div class="slot" data-gid="${g.id}" data-pid="${escapeHtml(g.participant_id || "")}">
      ${tag}
      ${header}
      <div class="preview">${img}</div>
      ${bodyText}
      <div class="row">
        ${(isErr || !g.has_image) ? "" : `<button type="button" class="gen-btn approve-btn">✓ Прийняти</button>`}
        <button type="button" class="del-btn reject-btn">🗑 Видалити</button>
      </div>
    </div>
  `;
}

async function approveGeneration(g) {
  if (!g.participant_id) throw new Error("Генерація не привʼязана до учасника");
  const url = `/api/generation-image/${g.id}?t=${Date.now()}`;
  const { left, right, split } = await splitCollage(url);
  await api("PUT", `/api/participants/${encodeURIComponent(g.participant_id)}`,
            { avatar_data_url: left, avatar_end_data_url: right });
  await api("DELETE", `/api/generations/${g.id}`);
  const msg = split === "vertical"
    ? "Розрізано: верх→початок, низ→кінець"
    : "Розрізано: ліве→початок, праве→кінець";
  setStatus(msg, "ok");
}

function wireQueueCard(g) {
  const card = queue.querySelector(`.slot[data-gid="${g.id}"]`);
  if (!card) return;
  card.querySelector(".approve-btn")?.addEventListener("click", async () => {
    try {
      await approveGeneration(g);
      await loadParticipants();
      await pollGenerations();
    } catch (e) { setStatus(e.message, "err"); }
  });
  card.querySelector(".reject-btn")?.addEventListener("click", async () => {
    try {
      await api("DELETE", `/api/generations/${g.id}`);
      await pollGenerations();
    } catch (e) { setStatus(e.message, "err"); }
  });
  card.querySelector(".preview")?.addEventListener("click", () => openModal(g));
}

// ─── модалка ───────────────────────────────────────────────────────
const modalBg = document.getElementById("modal-bg");
const modalPreview = document.getElementById("modal-preview");
const modalMeta = document.getElementById("modal-meta");
let modalGen = null;

function openModal(g) {
  modalGen = g;
  modalPreview.innerHTML = g.has_image
    ? `<img src="/api/generation-image/${g.id}?t=${Date.now()}">`
    : `<div style="padding:20px;color:#9aa0a6">Зображення немає</div>`;
  modalMeta.innerHTML = [
    `<span>модель: ${escapeHtml(g.model)}</span>`,
    `<span>провайдер: ${escapeHtml(g.provider)}</span>`,
    `<span>тариф: ${escapeHtml(g.service_tier)}</span>`,
    g.cost_usd != null ? `<span>$${Number(g.cost_usd).toFixed(5)}</span>` : "",
    g.prompt_tokens ? `<span>tokens in: ${g.prompt_tokens}</span>` : "",
    g.output_tokens ? `<span>tokens out: ${g.output_tokens}</span>` : "",
  ].filter(Boolean).join("");
  modalBg.classList.add("show");
}
function closeModal() {
  modalBg.classList.remove("show");
  modalGen = null;
}
document.getElementById("modal-close").addEventListener("click", closeModal);
modalBg.addEventListener("click", e => { if (e.target === modalBg) closeModal(); });
document.getElementById("modal-approve").addEventListener("click", async () => {
  if (!modalGen) return;
  try {
    await approveGeneration(modalGen);
    closeModal();
    await loadParticipants();
    await pollGenerations();
  } catch (e) { setStatus(e.message, "err"); }
});
document.getElementById("modal-reject").addEventListener("click", async () => {
  if (!modalGen) return;
  try {
    await api("DELETE", `/api/generations/${modalGen.id}`);
    closeModal();
    await pollGenerations();
  } catch (e) { setStatus(e.message, "err"); }
});

// ─── init ─────────────────────────────────────────────────────────
(async () => {
  try {
    const s = await api("GET", "/api/settings");
    await loadSettings(s);
    await loadAiSettings(s);
    await loadParticipants();
    await loadPrompt();
    await pollGenerations();
  } catch (e) { setStatus(e.message, "err"); }
})();
