<template>
  <section class="panel active">
    <div class="card">
      <h3>Параметри зустрічі</h3>
      <div class="flex">
        <div class="field"><label>Час початку</label><TimePicker v-if="loaded" :display="startDisplay" placeholder="13:41" @change="(p) => saveTime('start', p)" /></div>
        <div class="field"><label>Час кінця</label><TimePicker v-if="loaded" :display="endDisplay" placeholder="14:22" @change="(p) => saveTime('end', p)" /></div>
        <div class="field"><label for="s-code">Код зустрічі</label>
          <div class="input-with-btn"><input id="s-code" v-model="meetingCode" placeholder="mqy-kiph-fci" @change="saveSetting('meeting_code', meetingCode)" /><button type="button" class="icon-btn" title="Випадковий код" @click="genCode"><span class="msym">casino</span></button></div>
        </div>
      </div>
      <p class="muted" style="margin:8px 0 0">Час — 24-годинний (як в Україні), без AM/PM. Показується у шапці рендеру початку/кінця зустрічі.</p>
    </div>

    <div class="card card-tokens">
      <h3><span class="msym sm">key</span> API-токени</h3>
      <div class="flex">
        <div class="field" style="min-width:320px"><label for="s-key">OpenRouter API key</label>
          <div class="input-with-btn">
            <input id="s-key" v-model="apiKey" type="password" :placeholder="keyPlaceholder" :readonly="apiKeyLocked" :style="apiKeyLocked ? 'opacity:.6' : ''" autocomplete="off" spellcheck="false" @change="saveKey" />
            <button v-if="apiKeyLocked" type="button" class="icon-btn" title="Замінити ключ" @click="unlockKey"><span class="msym">edit</span></button>
          </div>
        </div>
        <div class="field"><label>Статус</label><span class="value" :class="apiKeyLocked ? 'status ok' : 'status err'">{{ apiKeyLocked ? 'ключ збережено' : 'ключ не задано' }}</span></div>
        <div class="field"><label>Баланс</label><div class="flex"><span class="value mono">{{ balance }}</span><button type="button" class="iconbtn" title="оновити баланс" @click="refreshBalance"><span class="msym">refresh</span></button></div></div>
      </div>
      <p class="muted" style="margin:8px 0 0">Застосунок постачається <b>без ключа</b> — встав свій OpenRouter API key (sk-or-…). Він зберігається лише в локальній базі цього компʼютера, нікуди (крім openrouter.ai) не передається й <b>не вшивається у білд</b>. Без нього AI-генерація не працює.</p>
    </div>

    <div class="card">
      <h3>AI-генерація (OpenRouter)</h3>
      <div class="flex">
        <div class="field"><label for="s-model">Модель</label>
          <select id="s-model" v-model="genModel" @change="saveSetting('gen_model', genModel)">
            <option value="google/gemini-2.5-flash-image">gemini-2.5-flash-image</option>
            <option value="google/gemini-3.5-flash" disabled>gemini-3.5-flash (text-only)</option>
          </select>
        </div>
        <div class="field"><label for="s-provider">Провайдер</label>
          <select id="s-provider" v-model="genProvider" @change="saveSetting('gen_provider', genProvider)"><option value="google-ai-studio">google-ai-studio</option><option value="google-vertex">google-vertex / global</option></select>
        </div>
        <div class="field"><label for="s-tier">Тариф</label>
          <select id="s-tier" v-model="genTier" @change="saveSetting('gen_tier', genTier)"><option value="flex">Flex · 0.5×</option><option value="default">Default · 1×</option><option value="priority">Priority · 1.8×</option></select>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Авто-деградація генерацій <span class="muted">(кодек, бейкається в результат)</span></h3>
      <div class="flex">
        <div class="field"><label for="s-degrade">Стан</label>
          <select id="s-degrade" v-model="degrade" @change="saveSetting('gen_degrade', degrade)"><option value="1">Увімкнено</option><option value="0">Вимкнено</option></select>
        </div>
        <div class="field"><label for="s-degrade-method">Метод</label>
          <select id="s-degrade-method" v-model="degradeMethod" @change="saveSetting('gen_degrade_method', degradeMethod)">
            <option value="gd-jpeg">Лише кодек (gd-jpeg)</option>
            <option value="gd">Повна вебка (gd)</option>
          </select>
        </div>
        <div class="field"><label for="s-degrade-min">Сила від, %</label><input id="s-degrade-min" v-model="degradeMin" type="number" min="0" max="100" placeholder="60" @change="saveSetting('gen_degrade_min', degradeMin)" /></div>
        <div class="field"><label for="s-degrade-max">Сила до, %</label><input id="s-degrade-max" v-model="degradeMax" type="number" min="0" max="100" placeholder="100" @change="saveSetting('gen_degrade_max', degradeMax)" /></div>
      </div>
      <p class="muted" style="margin:8px 0 0">Кожна згенерована картинка одразу після відповіді моделі стискається кодеком з випадковою силою з цього діапазону й бейкається у JPEG. Оригінал-вхід (input_image) лишається чистим — порівняння «оригінал → результат» працює.</p>
    </div>

    <div class="card">
      <h3>Розмір при збереженні <span class="muted">(під плитку Meet, при апруві)</span></h3>
      <div class="flex">
        <div class="field"><label for="s-resize">Стан</label>
          <select id="s-resize" v-model="resize" @change="saveSetting('gen_resize', resize)"><option value="1">Зменшувати</option><option value="0">Лишати як є</option></select>
        </div>
        <div class="field"><label for="s-resize-w">Ширина, px</label><input id="s-resize-w" v-model="resizeW" type="number" min="16" max="4096" placeholder="139" @change="saveSetting('gen_resize_w', resizeW)" /></div>
        <div class="field"><label for="s-resize-h">Висота, px</label><input id="s-resize-h" v-model="resizeH" type="number" min="16" max="4096" placeholder="185" @change="saveSetting('gen_resize_h', resizeH)" /></div>
      </div>
      <p class="muted" style="margin:8px 0 0">У галереї генерація лишається в оригінальному розмірі. Коли приймаєш її як аватар (→ Початок / → Кінець), фото пропорційно зменшується (cover, лише вниз), щоб покрити цю рамку.</p>
    </div>

    <div class="card">
      <h3><span class="msym sm">system_update</span> Оновлення додатку</h3>
      <div class="flex">
        <div class="field"><label>Поточна версія</label><span class="value mono">{{ currentVersion }}</span></div>
        <div class="field"><label>Статус</label><span class="value" :class="updStatusCls">{{ updStatusText }}</span></div>
        <div class="field" style="align-self:flex-end">
          <div class="flex">
            <button type="button" class="secondary btn-sm" :disabled="updChecking" @click="checkUpdates"><span class="msym sm">refresh</span> Перевірити оновлення</button>
            <button v-if="updReady" type="button" class="btn-sm" @click="installUpdate"><span class="msym sm">restart_alt</span> Перезапустити й оновити</button>
          </div>
        </div>
      </div>
      <p class="muted" style="margin:8px 0 0">{{ updHint }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import TimePicker from '@/components/TimePicker.vue'
import { api, call } from '@/lib/api'
import { randomMeetingCode } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import type { Settings, Credits } from '@/types'

const ui = useUiStore()

// ── Авто-апдейт (стан із main через store/updates) ──
const updates = useUpdatesStore()
const currentVersion = computed(() => updates.status?.currentVersion ?? '—')
const updChecking = computed(() => updates.status?.state === 'checking')
const updReady = computed(() => updates.status?.state === 'downloaded')
const updStatusText = computed(() => {
  const s = updates.status
  switch (s?.state) {
    case 'checking': return 'перевірка…'
    case 'available': return `доступне ${s.version ?? ''}`.trim()
    case 'downloading': return `завантаження ${Math.round(s.percent ?? 0)}%`
    case 'downloaded': return `готово до встановлення ${s.version ?? ''}`.trim()
    case 'not-available': return 'актуальна версія'
    case 'error': return 'помилка перевірки'
    case 'disabled': return 'вимкнено'
    default: return 'не перевірялось'
  }
})
const updStatusCls = computed(() => {
  const st = updates.status?.state
  if (st === 'not-available' || st === 'downloaded') return 'status ok'
  if (st === 'error') return 'status err'
  return ''
})
const updHint = computed(() => {
  const s = updates.status
  if (s?.state === 'disabled') return s.message ?? 'Оновлення вимкнено для цієї збірки.'
  if (s?.state === 'error') return `Помилка: ${s.message ?? 'невідома'}. Перевірте звʼязок і токен у .env (приватний репо).`
  return 'Оновлення завантажуються у фоні з GitHub Releases. Коли готове — натисніть «Перезапустити й оновити» (або застосується при наступному виході). Windows — авто-апдейт; macOS — поки вручну (потрібен підпис Apple).'
})
function checkUpdates(): void {
  void updates.check()
  ui.toast('Перевірка оновлень…')
}
function installUpdate(): void {
  void updates.install()
}
const loaded = ref(false)
const meetingCode = ref('')
const startDisplay = ref('13:41')
const endDisplay = ref('14:22')
const apiKey = ref('')
const apiKeyLocked = ref(false)
const keyPlaceholder = computed(() => (apiKeyLocked.value ? '•••••• (з .env або БД)' : 'sk-or-...'))
const genModel = ref('google/gemini-2.5-flash-image')
const genProvider = ref('google-ai-studio')
const genTier = ref('flex')
const degrade = ref('1')
const degradeMethod = ref('gd-jpeg')
const degradeMin = ref<string | number>(60)
const degradeMax = ref<string | number>(100)
const resize = ref('1')
const resizeW = ref<string | number>(139)
const resizeH = ref<string | number>(185)
const balance = ref('—')

async function saveSetting(key: string, value: unknown): Promise<void> {
  try {
    await call('PUT', '/api/settings', { [key]: value })
    ui.toast('Збережено', 'ok')
  } catch {
    /* call() already toasted */
  }
}
async function genCode(): Promise<void> {
  const code = randomMeetingCode()
  meetingCode.value = code
  await call('PUT', '/api/settings', { meeting_code: code })
  ui.toast('Згенеровано: ' + code, 'ok')
}
function saveTime(which: 'start' | 'end', p: { time: string }): void {
  const body = which === 'start' ? { start_time: p.time } : { end_time: p.time }
  void (async () => {
    await call('PUT', '/api/settings', body)
    ui.toast('Збережено', 'ok')
  })()
}
async function saveKey(): Promise<void> {
  const v = apiKey.value.trim()
  if (!v) return
  if (!v.startsWith('sk-or-')) {
    ui.toast('Ключ має починатись з sk-or-…', 'err')
    return
  }
  await call('PUT', '/api/settings', { openrouter_api_key: v })
  apiKey.value = ''
  apiKeyLocked.value = true
  ui.toast('Ключ збережено', 'ok')
}
function unlockKey(): void {
  apiKeyLocked.value = false
  apiKey.value = ''
}
async function refreshBalance(): Promise<void> {
  balance.value = '…'
  try {
    const d = await api<Credits>('GET', '/api/credits')
    const data = d.data || d
    const left = Number(data.total_credits ?? 0) - Number(data.total_usage ?? 0)
    balance.value = `$${left.toFixed(4)}`
  } catch (e: any) {
    balance.value = '—'
    ui.toast(e.message, 'err')
  }
}

async function load(): Promise<void> {
  const s = await call<Settings>('GET', '/api/settings')
  meetingCode.value = s.meeting_code || ''
  startDisplay.value = s.start_time || '13:41'
  endDisplay.value = s.end_time || '14:22'
  if (s.gen_model && ['google/gemini-2.5-flash-image', 'google/gemini-3.5-flash'].includes(s.gen_model)) genModel.value = s.gen_model
  if (s.gen_provider) genProvider.value = String(s.gen_provider)
  if (s.gen_tier) genTier.value = String(s.gen_tier)
  degrade.value = String(s.gen_degrade) === '0' || s.gen_degrade === '' ? '0' : '1'
  if (s.gen_degrade_method && ['gd-jpeg', 'gd'].includes(String(s.gen_degrade_method))) degradeMethod.value = String(s.gen_degrade_method)
  degradeMin.value = (s.gen_degrade_min ?? 60) as string | number
  degradeMax.value = (s.gen_degrade_max ?? 100) as string | number
  resize.value = String(s.gen_resize) === '0' || s.gen_resize === '' ? '0' : '1'
  resizeW.value = (s.gen_resize_w ?? 139) as string | number
  resizeH.value = (s.gen_resize_h ?? 185) as string | number
  apiKeyLocked.value = !!s.openrouter_api_key_set
  loaded.value = true
}

onMounted(() => {
  void updates.init() // idempotent (guard у store) — на випадок прямого заходу в Налаштування
  void load()
})
</script>
