<template>
  <div class="admin-head">
    <div class="links"><router-link to="/admin">⚙ Адмін-панель →</router-link></div>
  </div>
  <p class="hint">
    Зміни зберігаються одразу у SQLite. Кнопка «Переглянути» відкриє сторінку
    зустрічі з усіма правками; «Зберегти HTML» скачає той самий результат як
    файл. Pavlo Grinevich і «3 others» лишаються без змін.
  </p>

  <div class="toolbar">
    <button @click="openPreview('start')">▶ Перегляд (початок)</button>
    <button @click="openPreview('end')">⏵⏵ Перегляд (кінець)</button>
    <button class="secondary" @click="save('start')">⤓ HTML початок</button>
    <button class="secondary" @click="save('end')">⤓ HTML кінець</button>
    <span class="status" :class="status.cls">{{ status.msg }}</span>
  </div>

  <h2>Параметри зустрічі</h2>
  <div class="meeting-bar">
    <div class="field">
      <label>Час початку</label>
      <TimePicker v-if="loaded" :display="startDisplay" placeholder="10:34 PM" @change="(p) => saveTime('start', p)" />
    </div>
    <div class="field">
      <label>Час кінця</label>
      <TimePicker v-if="loaded" :display="endDisplay" placeholder="11:15 PM" @change="(p) => saveTime('end', p)" />
    </div>
    <div class="field">
      <label for="f-code">Код зустрічі</label>
      <div class="input-with-btn">
        <input id="f-code" v-model="meetingCode" placeholder="yrt-kczi-csw" @change="saveCode" />
        <button type="button" class="icon-btn" title="Згенерувати випадковий код" @click="genCode">🎲</button>
      </div>
    </div>
  </div>

  <h2>Генерація аватарок (OpenRouter)</h2>
  <div class="ai-panel">
    <div class="field">
      <label for="f-key">OpenRouter API key</label>
      <input
        id="f-key"
        v-model="apiKey"
        type="password"
        :placeholder="keyPlaceholder"
        :readonly="apiKeyLocked"
        :style="apiKeyLocked ? 'opacity:.6' : ''"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @change="saveKey"
      />
    </div>
    <div class="field">
      <label for="f-model">Модель</label>
      <select id="f-model" v-model="genModel" @change="saveSetting('gen_model', genModel)">
        <option value="google/gemini-2.5-flash-image">gemini-2.5-flash-image (image gen)</option>
        <option value="google/gemini-3.5-flash" disabled>gemini-3.5-flash (text-only — без картинок)</option>
      </select>
    </div>
    <div class="field">
      <label for="f-provider">Провайдер</label>
      <select id="f-provider" v-model="genProvider" @change="saveSetting('gen_provider', genProvider)">
        <option value="google-ai-studio">google-ai-studio</option>
        <option value="google-vertex">google-vertex / global</option>
      </select>
    </div>
    <div class="field">
      <label for="f-tier">Тариф</label>
      <select id="f-tier" v-model="genTier" @change="saveSetting('gen_tier', genTier)">
        <option value="flex">Flex · 0.5×</option>
        <option value="default">Default · 1×</option>
        <option value="priority">Priority · 1.8×</option>
      </select>
    </div>
    <div class="balance">
      <span>Баланс OpenRouter</span>
      <span class="value">{{ balanceText }}</span>
      <button type="button" @click="refreshBalance">Оновити</button>
    </div>
  </div>

  <h2>Промт для генерації <span style="font-weight:400;color:#9aa0a6;font-size:12px;text-transform:none;letter-spacing:0">(файл promt.md)</span></h2>
  <div class="prompt-box">
    <textarea v-model="prompt" spellcheck="false" placeholder="Завантажується..." @change="savePrompt"></textarea>
  </div>

  <h2>Учасники</h2>
  <div class="add-participant-bar">
    <button class="secondary" @click="addParticipant">+ Додати учасника</button>
  </div>
  <div class="grid">
    <ParticipantSlot
      v-for="p in participants"
      :key="p.device_id"
      :participant="p"
      :gen-state="genStates.get(p.device_id) || { kind: 'idle' }"
      @status="setStatus"
      @generate="ensurePolling"
      @deleted="onParticipantDeleted"
    />
  </div>

  <h2 v-show="queueCards.length">Чекає на апрув</h2>
  <div class="grid">
    <div v-for="g in queueCards" :key="g.id" class="slot" :data-gid="g.id">
      <span v-if="isEmptyImage(g)" class="user-tag">обробка</span>
      <span v-else-if="g.status === 'error'" class="skip-tag">помилка</span>
      <span v-else class="user-tag">готово</span>

      <div class="queue-head">
        <strong>{{ g.participant_name || '—' }}</strong>
        <span v-if="g._variantTotal > 1" class="variant-pill">варіант {{ g._variantIdx }}/{{ g._variantTotal }}</span>
      </div>

      <div class="preview" @click="openModal(g)">
        <img v-if="g.has_image" :src="`/api/generation-image/${g.id}?t=${genBust}`" />
      </div>

      <template v-if="isEmptyImage(g)">
        <div>Модель не повернула картинку — натисни ✨ Згенерувати ще раз</div>
        <div class="loader-bar"></div>
      </template>
      <div v-else class="original">{{ g.status === 'error' ? (g.error || '') : metaStr(g) }}</div>

      <div class="row">
        <button v-if="g.status !== 'error' && g.has_image" type="button" class="gen-btn approve-btn" @click="approveFromQueue(g)">✓ Прийняти</button>
        <button type="button" class="del-btn reject-btn" @click="rejectGeneration(g)">🗑 Видалити</button>
      </div>
    </div>
  </div>

  <div class="modal-bg" :class="{ show: modalGen }">
    <div class="modal">
      <h3>Перегляд генерації</h3>
      <div class="gen-preview">
        <img v-if="modalGen && modalGen.has_image" :src="`/api/generation-image/${modalGen.id}?t=${genBust}`" />
        <div v-else-if="modalGen" style="padding:20px;color:#9aa0a6">Зображення немає</div>
      </div>
      <div class="gen-meta">
        <template v-if="modalGen">
          <span>модель: {{ modalGen.model }}</span>
          <span>провайдер: {{ modalGen.provider }}</span>
          <span>тариф: {{ modalGen.service_tier }}</span>
          <span v-if="modalGen.cost_usd != null">${{ Number(modalGen.cost_usd).toFixed(5) }}</span>
          <span v-if="modalGen.prompt_tokens">tokens in: {{ modalGen.prompt_tokens }}</span>
          <span v-if="modalGen.output_tokens">tokens out: {{ modalGen.output_tokens }}</span>
        </template>
      </div>
      <div class="modal-actions">
        <button class="secondary" @click="closeModal">Закрити</button>
        <button class="reject" @click="modalReject">Видалити</button>
        <button @click="modalApprove">Прийняти як аватар</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import TimePicker from '@/components/TimePicker.vue'
import ParticipantSlot, { type GenState } from '@/components/editor/ParticipantSlot.vue'
import { api } from '@/lib/api'
import { randomMeetingCode, splitCollage } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import type { Participant, Generation, Settings, Credits } from '@/types'

const ui = useUiStore()

// ── status line (port of makeStatus: 'ok' auto-clears after 1800ms) ──
const status = ref<{ msg: string; cls: string }>({ msg: '', cls: '' })
let statusTimer: ReturnType<typeof setTimeout> | null = null
function setStatus(msg: string, cls = ''): void {
  status.value = { msg, cls }
  if (statusTimer) clearTimeout(statusTimer)
  if (cls === 'ok') statusTimer = setTimeout(() => { status.value = { msg: '', cls: '' } }, 1800)
}

// ── meeting + AI settings ──
const loaded = ref(false)
const meetingCode = ref('')
const startDisplay = ref('10:34 PM')
const endDisplay = ref('11:15 PM')
const apiKey = ref('')
const apiKeyLocked = ref(false)
const keyPlaceholder = computed(() => (apiKeyLocked.value ? '•••••• (з .env або БД)' : 'sk-or-...'))
const genModel = ref('google/gemini-2.5-flash-image')
const genProvider = ref('google-ai-studio')
const genTier = ref('flex')
const balanceText = ref('—')
const prompt = ref('')

async function saveSetting(key: string, value: unknown): Promise<void> {
  try {
    await api('PUT', '/api/settings', { [key]: value })
    setStatus('Збережено', 'ok')
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}
function saveCode(): void {
  void saveSetting('meeting_code', meetingCode.value)
}
async function genCode(): Promise<void> {
  const code = randomMeetingCode()
  meetingCode.value = code
  try {
    await api('PUT', '/api/settings', { meeting_code: code })
    setStatus('Згенеровано: ' + code, 'ok')
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}
function saveTime(which: 'start' | 'end', p: { time: string; period: string }): void {
  const body = which === 'start'
    ? { start_time: p.time, start_period: p.period }
    : { end_time: p.time, end_period: p.period }
  void (async () => {
    try {
      await api('PUT', '/api/settings', body)
      setStatus('Збережено', 'ok')
    } catch (e: any) {
      setStatus(e.message, 'err')
    }
  })()
}
async function saveKey(): Promise<void> {
  const v = apiKey.value.trim()
  if (!v) return
  if (!v.startsWith('sk-or-')) {
    setStatus('Ключ має починатись з sk-or-…', 'err')
    return
  }
  await saveSetting('openrouter_api_key', v)
  apiKey.value = ''
  apiKeyLocked.value = true
}
async function savePrompt(): Promise<void> {
  try {
    await api('PUT', '/api/prompt', { prompt: prompt.value })
    setStatus('Промт збережено у promt.md', 'ok')
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}
async function refreshBalance(): Promise<void> {
  balanceText.value = '…'
  try {
    const d = await api<Credits>('GET', '/api/credits')
    const data = d.data || d
    const total = Number(data.total_credits ?? 0)
    const used = Number(data.total_usage ?? 0)
    balanceText.value = `$${(total - used).toFixed(4)} (з ${total.toFixed(2)})`
  } catch (e: any) {
    balanceText.value = '—'
    setStatus('Баланс: ' + e.message, 'err')
  }
}

// ── participants ──
const participants = ref<Participant[]>([])
async function loadParticipants(): Promise<void> {
  participants.value = await api<Participant[]>('GET', '/api/participants')
}
async function addParticipant(): Promise<void> {
  const name = await ui.prompt({ title: 'Новий учасник', label: 'Імʼя учасника', placeholder: 'напр. Олег', okText: 'Додати' })
  if (!name || !name.trim()) return
  try {
    await api('POST', '/api/participants', { custom_name: name.trim() })
    await loadParticipants()
    setStatus('Додано', 'ok')
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}
function onParticipantDeleted(deviceId: string): void {
  participants.value = participants.value.filter((p) => p.device_id !== deviceId)
}

// ── generations: per-slot status + review queue ──
const generations = ref<Generation[]>([])
const genBust = ref(Date.now())
let pollTimer: ReturnType<typeof setInterval> | null = null

const genStates = computed<Map<string, GenState>>(() => {
  const map = new Map<string, GenState>()
  for (const p of participants.value) {
    const mine = generations.value.filter((g) => g.participant_id === p.device_id)
    const pending = mine.find((g) => g.status === 'pending')
    const err = mine.find((g) => g.status === 'error')
    if (pending) map.set(p.device_id, { kind: 'pending', id: pending.id })
    else if (err) map.set(p.device_id, { kind: 'error', error: err.error })
    else map.set(p.device_id, { kind: 'idle' })
  }
  return map
})

interface QueueCard extends Generation { _variantIdx: number; _variantTotal: number }
const queueCards = computed<QueueCard[]>(() => {
  const reviewable = generations.value.filter((g) => g.status === 'done' || g.status === 'error')
  const grouped = new Map<string, Generation[]>()
  for (const g of reviewable) {
    const key = g.participant_id || '_orphan'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(g)
  }
  const out: QueueCard[] = []
  for (const arr of grouped.values()) {
    arr.forEach((g, i) => out.push({ ...g, _variantIdx: i + 1, _variantTotal: arr.length }))
  }
  return out
})

function isEmptyImage(g: Generation): boolean {
  return g.status === 'error' && /image_url|не повернула зображення/.test(g.error || '')
}
function metaStr(g: Generation): string {
  return [g.model, g.provider, g.service_tier, g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : '']
    .filter(Boolean)
    .join(' · ')
}

async function pollGenerations(): Promise<void> {
  let list: Generation[]
  try {
    list = await api<Generation[]>('GET', '/api/generations')
  } catch {
    return
  }
  generations.value = list
  genBust.value = Date.now()
  if (!list.some((g) => g.status === 'pending')) stopPolling()
}
function ensurePolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(pollGenerations, 2000)
  void pollGenerations()
}
function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

// ── approve / reject ──
async function approveGeneration(g: Generation): Promise<void> {
  if (!g.participant_id) throw new Error('Генерація не привʼязана до учасника')
  const { left, right, split } = await splitCollage(`/api/generation-image/${g.id}?t=${Date.now()}`)
  await api('PUT', `/api/participants/${encodeURIComponent(g.participant_id)}`, {
    avatar_data_url: left,
    avatar_end_data_url: right,
  })
  await api('DELETE', `/api/generations/${g.id}`)
  setStatus(split === 'vertical' ? 'Розрізано: верх→початок, низ→кінець' : 'Розрізано: ліве→початок, праве→кінець', 'ok')
}
async function approveFromQueue(g: Generation): Promise<void> {
  try {
    await approveGeneration(g)
    await loadParticipants()
    await pollGenerations()
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}
async function rejectGeneration(g: Generation): Promise<void> {
  try {
    await api('DELETE', `/api/generations/${g.id}`)
    await pollGenerations()
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}

// ── modal ──
const modalGen = ref<Generation | null>(null)
function openModal(g: Generation): void {
  genBust.value = Date.now()
  modalGen.value = g
}
function closeModal(): void {
  modalGen.value = null
}
async function modalApprove(): Promise<void> {
  if (!modalGen.value) return
  try {
    await approveGeneration(modalGen.value)
    closeModal()
    await loadParticipants()
    await pollGenerations()
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}
async function modalReject(): Promise<void> {
  if (!modalGen.value) return
  try {
    await api('DELETE', `/api/generations/${modalGen.value.id}`)
    closeModal()
    await pollGenerations()
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
}

// ── preview / save ──
const previewWins: Record<string, Window | null> = { start: null, end: null }
function openPreview(which: 'start' | 'end'): void {
  const url = `/api/render?which=${which}&t=${Date.now()}`
  const w = previewWins[which]
  if (!w || w.closed) {
    previewWins[which] = window.open(url, `meet-preview-${which}`)
  } else {
    w.location.replace(url)
    w.focus()
  }
}
function save(which: 'start' | 'end'): void {
  window.location.href = `/api/render?which=${which}&download=1`
}

// ── init ──
onMounted(async () => {
  try {
    const s = await api<Settings>('GET', '/api/settings')
    meetingCode.value = s.meeting_code || ''
    startDisplay.value = `${s.start_time || '10:34'} ${s.start_period || 'PM'}`
    endDisplay.value = `${s.end_time || '11:15'} ${s.end_period || 'PM'}`
    if (s.gen_model && ['google/gemini-2.5-flash-image', 'google/gemini-3.5-flash'].includes(s.gen_model)) genModel.value = s.gen_model
    if (s.gen_provider) genProvider.value = String(s.gen_provider)
    if (s.gen_tier) genTier.value = String(s.gen_tier)
    apiKeyLocked.value = !!s.openrouter_api_key_set
    loaded.value = true
    await loadParticipants()
    const pr = await api<{ prompt: string }>('GET', '/api/prompt')
    prompt.value = pr.prompt || ''
    await pollGenerations()
  } catch (e: any) {
    setStatus(e.message, 'err')
  }
})
onBeforeUnmount(() => {
  stopPolling()
  if (statusTimer) clearTimeout(statusTimer)
})
</script>
