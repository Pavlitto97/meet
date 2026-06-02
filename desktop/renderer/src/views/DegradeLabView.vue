<template>
  <div class="admin-shell">
    <div class="admin-head">
      <h1><span class="msym">camera</span> Лабораторія деградації</h1>
      <div class="links">
        <router-link to="/admin"><span class="msym">arrow_back</span> Адмінка</router-link>
        <router-link to="/editor"><span class="msym">edit</span> Редактор</router-link>
        <a :href="openRenderHref" target="_blank"><span class="msym">open_in_new</span> Повний рендер</a>
      </div>
    </div>
    <p class="hint">Перемикай підходи й силу — і дивись, як аватарка стає схожою на кадр з поганої вебки.
      «Сервер (GD)» бейкає деградацію в пікселі (справжні JPEG-блоки, шум), «браузер (CSS)» — накладає
      фільтр на льоту (видно у скріні, байти не міняються). Дефолтний рендер без обраного підходу — недоторканий.</p>

    <div class="lab-grid">
      <!-- Панель керування -->
      <div class="card">
        <h3>Підхід</h3>
        <div class="seg">
          <button
            v-for="m in methods"
            :key="m.key"
            class="secondary"
            :class="{ sel: m.key === method }"
            @click="setMethod(m.key)"
          >
            <span class="msym sm">{{ layerIcon(m.layer) }}</span>
            <span>{{ m.label }}</span>
            <span class="layer">{{ layerLabel(m.layer) }}</span>
          </button>
        </div>
        <div class="method-desc">{{ methodMeta(method)?.desc || '' }}</div>

        <h3 style="margin-top:18px">Сила ефекту</h3>
        <div class="range-row">
          <input v-model.number="intensity" type="range" min="0" max="100" step="5" />
          <span class="range-val">{{ intensity }}%</span>
        </div>

        <h3 style="margin-top:18px">Кадр і обличчя</h3>
        <div class="field">
          <label for="which">Який кадр</label>
          <select id="which" v-model="which"><option value="start">Початок зустрічі</option><option value="end">Кінець зустрічі</option></select>
        </div>
        <div class="field" style="margin-top:10px">
          <label for="participant">Учасник (для порівняння)</label>
          <select id="participant" v-model="did">
            <option v-if="!participants.length" :value="null">немає аватарок — згенеруй у адмінці</option>
            <option v-for="p in participants" :key="p.device_id" :value="p.device_id">{{ participantLabel(p) }}</option>
          </select>
        </div>

        <div class="flex" style="margin-top:18px">
          <button @click="saveDefault"><span class="msym">save</span>Зберегти як дефолт</button>
          <button class="secondary" @click="reset"><span class="msym">restart_alt</span>Скинути</button>
        </div>
        <p class="muted" style="font-size:12px;margin-top:8px">«Дефолт» застосовується до скрінів з адмінки.</p>
      </div>

      <!-- Перегляди -->
      <div>
        <div class="card">
          <h3>Оригінал ↔ результат</h3>
          <div class="compare">
            <figure>
              <figcaption><span class="msym sm">image</span>Оригінал</figcaption>
              <div class="imgbox"><img v-if="origSrc" :src="origSrc" alt="оригінал" /></div>
            </figure>
            <figure>
              <figcaption><span class="msym sm">blur_on</span>Деградовано <span class="muted">{{ degCamLabel }}</span></figcaption>
              <div class="imgbox"><img v-if="degSrc" :src="degSrc" :style="{ filter: degFilter }" alt="результат" /></div>
            </figure>
          </div>
        </div>

        <div class="card">
          <h3>Усі підходи на поточній силі</h3>
          <div class="grid">
            <div v-for="c in gridCells" :key="c.key" class="gcell" :class="{ sel: c.key === method }" @click="setMethod(c.key)">
              <div class="imgbox"><img v-if="c.src" :src="c.src" :style="{ filter: c.filter }" /></div>
              <div class="gcap">{{ c.label }}</div>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>У контексті Meet (живий рендер)</h3>
          <div ref="wrapEl" class="frame-wrap"><iframe ref="frameEl" :src="frameSrc" title="рендер" @load="scaleFrame"></iframe></div>
          <div class="flex" style="margin-top:12px">
            <button :disabled="shootBusy" @click="shoot"><span class="msym">photo_camera</span>Скріншот цим підходом</button>
            <span class="muted" style="font-size:12px">Headless Chrome, 1920×1080 — ~3с.</span>
          </div>
          <div v-show="shotSrc" style="margin-top:12px">
            <figcaption class="muted" style="font-size:12px;margin-bottom:6px">Результат скріна:</figcaption>
            <img v-if="shotSrc" :src="shotSrc" class="shot-box" alt="скрін" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { api } from '@/lib/api'
import { debounce } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import type { DegradeMethod, DegradeSpec, Participant } from '@/types'

const ui = useUiStore()
const ENC = encodeURIComponent
const FIT = { w: 1280, h: 720 }

const methods = ref<DegradeMethod[]>([])
const participants = ref<Participant[]>([])
const method = ref('none')
const intensity = ref(35)
const which = ref<'start' | 'end'>('start')
const did = ref<string | null>(null)
const specCache = new Map<string, DegradeSpec>()

const origSrc = ref('')
const degSrc = ref('')
const degFilter = ref('')
const frameSrc = ref('')
const openRenderHref = ref('/api/render?which=start')
const shotSrc = ref('')
const shootBusy = ref(false)

interface GridCell { key: string; label: string; src: string; filter: string }
const gridCells = ref<GridCell[]>([])

const wrapEl = ref<HTMLElement | null>(null)
const frameEl = ref<HTMLIFrameElement | null>(null)

const degCamLabel = computed(() => (method.value === 'none' ? '' : `· ${method.value}:${intensity.value}`))

function methodMeta(key: string): DegradeMethod | undefined {
  return methods.value.find((m) => m.key === key) || methods.value[0]
}
function layerIcon(layer: string): string {
  return layer === 'server' ? 'memory' : layer === 'browser' ? 'web' : 'block'
}
function layerLabel(layer: string): string {
  return ({ none: '—', server: 'сервер', browser: 'браузер' } as Record<string, string>)[layer] || layer
}
function participantLabel(p: Participant): string {
  return (p.custom_name || p.original_name || p.device_id) + (p.has_avatar ? '' : ' (лише кінець)')
}
function camStr(m: string, i: number): string {
  return m === 'none' ? '' : `${m}:${i}`
}
function avatarUrl(): string {
  return `/api/avatar/${ENC(did.value as string)}?which=${which.value}`
}
function previewUrl(m: string): string {
  return `/api/degrade-preview?did=${ENC(did.value as string)}&which=${which.value}&cam=${ENC(camStr(m, intensity.value))}&t=${Date.now()}`
}
async function getSpec(m: string, i: number): Promise<DegradeSpec> {
  if (m === 'none') return { filter: '', svg: '' }
  const key = `${m}:${i}`
  const cached = specCache.get(key)
  if (cached) return cached
  const s = await api<DegradeSpec>('GET', `/api/degrade-spec?cam=${ENC(key)}`)
  specCache.set(key, s)
  return s
}

async function updateSingle(): Promise<void> {
  if (!did.value) return
  origSrc.value = avatarUrl()
  degFilter.value = ''
  const layer = methodMeta(method.value)?.layer
  if (method.value === 'none') {
    degSrc.value = avatarUrl()
  } else if (layer === 'server') {
    degSrc.value = previewUrl(method.value)
  } else {
    degSrc.value = avatarUrl()
    const spec = await getSpec(method.value, intensity.value)
    degFilter.value = spec.filter
  }
}
async function updateGrid(): Promise<void> {
  if (!did.value) return
  const cssSpec = await getSpec('css', intensity.value)
  gridCells.value = methods.value.map((m) => {
    if (m.key === 'none') return { key: m.key, label: m.label, src: avatarUrl(), filter: '' }
    if (m.layer === 'server') return { key: m.key, label: m.label, src: previewUrl(m.key), filter: '' }
    return { key: m.key, label: m.label, src: avatarUrl(), filter: cssSpec.filter }
  })
}
function updateIframe(): void {
  const cam = camStr(method.value, intensity.value)
  frameSrc.value = `/api/render?which=${which.value}&fit=${FIT.w}x${FIT.h}` + (cam ? `&cam=${ENC(cam)}` : '')
  openRenderHref.value = `/api/render?which=${which.value}` + (cam ? `&cam=${ENC(cam)}` : '')
}

const renderLight = debounce(() => { void updateSingle(); void updateGrid() }, 150)
const renderFrame = debounce(() => updateIframe(), 450)
function renderAll(): void {
  renderLight()
  renderFrame()
}

function scaleFrame(): void {
  const wrap = wrapEl.value
  const frame = frameEl.value
  if (!wrap || !frame) return
  const scale = wrap.clientWidth / FIT.w
  frame.style.width = FIT.w + 'px'
  frame.style.height = FIT.h + 'px'
  frame.style.transform = `scale(${scale})`
  wrap.style.height = Math.round(FIT.h * scale) + 'px'
}
const scaleFrameDebounced = debounce(scaleFrame, 100)

function setMethod(key: string): void {
  method.value = key
}

async function saveDefault(): Promise<void> {
  try {
    await api('PUT', '/api/settings', { cam_method: method.value, cam_intensity: String(intensity.value) })
    ui.toast('Збережено як дефолт — скріни з адмінки тепер цим підходом', 'ok')
  } catch (e: any) {
    ui.toast(e.message, 'err')
  }
}
function reset(): void {
  method.value = 'none'
  intensity.value = 35
}
async function shoot(): Promise<void> {
  shootBusy.value = true
  ui.toast('Роблю скрін через Chrome…')
  try {
    const cam = camStr(method.value, intensity.value) || 'none'
    const r = await api<{ id: number }>('POST', '/api/screenshots', {
      which: which.value,
      width: 1920,
      height: 1080,
      cam,
      label: `lab ${cam}`,
    })
    shotSrc.value = `/api/screenshot-image/${r.id}?t=${Date.now()}`
    ui.toast('Скрін готовий', 'ok')
  } catch (e: any) {
    ui.toast(e.message, 'err')
  } finally {
    shootBusy.value = false
  }
}

// method / intensity / which → full render; participant → light render only.
watch([method, intensity, which], renderAll)
watch(did, renderLight)

let ro: ResizeObserver | null = null
onMounted(async () => {
  try {
    methods.value = (await api<{ methods: DegradeMethod[] }>('GET', '/api/degrade-methods')).methods || []
    const ps = await api<Participant[]>('GET', '/api/participants')
    const withAv = ps.filter((p) => p.has_avatar || p.has_avatar_end)
    const s = await api<{ cam_method?: string; cam_intensity?: string | number }>('GET', '/api/settings')
    method.value = s.cam_method || 'none'
    intensity.value = Number(s.cam_intensity || 35)
    if (!withAv.length) {
      ui.toast('Немає учасників з аватарками — спочатку додай/згенеруй фото', 'err')
    } else {
      participants.value = withAv
      did.value = withAv[0].device_id
    }
    if (wrapEl.value) {
      ro = new ResizeObserver(() => scaleFrameDebounced())
      ro.observe(wrapEl.value)
    }
    window.addEventListener('resize', scaleFrameDebounced)
    scaleFrame()
    renderAll()
  } catch (e: any) {
    ui.toast('Помилка ініціалізації: ' + e.message, 'err')
  }
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', scaleFrameDebounced)
})
</script>

<style scoped>
/* Локальні стилі лабораторії (поверх токенів admin.css) */
.lab-grid { display: grid; grid-template-columns: 320px 1fr; gap: 18px; align-items: start; }
@media (max-width: 900px) { .lab-grid { grid-template-columns: 1fr; } }

.seg { display: flex; flex-direction: column; gap: 6px; }
.seg button {
  justify-content: flex-start; text-align: left; width: 100%;
  border-radius: var(--r-md); gap: 10px;
}
.seg button .layer {
  margin-left: auto; font-size: 11px; color: var(--muted);
  border: 1px solid var(--outline-variant); border-radius: var(--r-full); padding: 1px 8px;
}
.seg button.sel { background: var(--primary-container); color: var(--accent-dim); }
.method-desc { color: var(--muted); font-size: 12.5px; margin: 6px 2px 0; min-height: 34px; }

.range-row { display: flex; align-items: center; gap: 12px; }
.range-row input[type=range] { flex: 1; accent-color: var(--accent); }
.range-val { font-variant-numeric: tabular-nums; min-width: 44px; text-align: right; font-weight: 500; }

.compare { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.compare figure { margin: 0; }
.compare figcaption { color: var(--muted); font-size: 12px; margin-bottom: 6px; display: flex; gap: 6px; align-items: center; }
.imgbox {
  aspect-ratio: 1/1; background: #000 center/cover; border-radius: var(--r-md);
  overflow: hidden; border: 1px solid var(--outline-variant); display: grid; place-items: center;
}
.imgbox img { width: 100%; height: 100%; object-fit: cover; display: block; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.gcell { cursor: pointer; border: 2px solid transparent; border-radius: var(--r-md); padding: 4px; transition: border-color var(--dur) var(--ease); }
.gcell:hover { border-color: var(--outline); }
.gcell.sel { border-color: var(--accent); }
.gcell .imgbox { aspect-ratio: 1/1; }
.gcap { font-size: 12px; text-align: center; margin-top: 6px; color: var(--on-surface-variant); }

.frame-wrap { position: relative; width: 100%; overflow: hidden; border-radius: var(--r-md); border: 1px solid var(--outline-variant); background: #000; }
.frame-wrap iframe { border: 0; transform-origin: top left; }
.shot-box { max-width: 100%; border-radius: var(--r-md); border: 1px solid var(--outline-variant); display: block; }
</style>
