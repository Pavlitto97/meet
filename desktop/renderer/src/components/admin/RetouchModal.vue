<template>
  <div v-if="gen" class="modal-bg show" @mousedown.self="tryClose">
    <div class="modal retouch-modal" role="dialog" aria-modal="true">
      <h3><span class="msym">brush</span> Ретуш #{{ gen.id }} — {{ gen.participant_name || '—' }}</h3>
      <div class="gen-meta">
        <span v-if="gen.group_name">група: {{ gen.group_name }}</span>
        <span v-if="gen.retouched" class="badge user" title="image вже ретушований; оригінал збережено">ретушовано раніше</span>
        <span class="crop-head-hint">кисть — веди мишею по фото; область — виділи прямокутник; Ctrl+Z — крок назад</span>
      </div>

      <!-- Інструменти -->
      <div class="rt-toolbar">
        <span class="rt-group">
          <span class="rt-label">Інструмент</span>
          <button class="gen-btn" :class="{ on: tool === 'brush' }" title="малюй ефект кистю" @click="tool = 'brush'">
            <span class="msym sm">brush</span> Кисть
          </button>
          <button class="gen-btn" :class="{ on: tool === 'rect' }" title="виділи прямокутну область — ефект застосується до неї" @click="tool = 'rect'">
            <span class="msym sm">select</span> Область
          </button>
        </span>
        <span class="rt-group">
          <span class="rt-label">Ефект</span>
          <button class="gen-btn" :class="{ on: effect === 'pixelate' }" title="пікселізація (мозаїка)" @click="effect = 'pixelate'">
            <span class="msym sm">grid_on</span> Пікселі
          </button>
          <button class="gen-btn" :class="{ on: effect === 'blur' }" title="розмиття по Гаусу" @click="effect = 'blur'">
            <span class="msym sm">blur_on</span> Блюр
          </button>
          <button class="gen-btn" :class="{ on: effect === 'fill' }" title="суцільне замазування кольором" @click="effect = 'fill'">
            <span class="msym sm">format_paint</span> Замазати
          </button>
        </span>
        <span v-if="tool === 'brush'" class="rt-group">
          <span class="rt-label">Кисть {{ brushSize }}px</span>
          <input v-model.number="brushSize" type="range" min="10" max="300" step="2" />
        </span>
        <span v-if="effect === 'pixelate'" class="rt-group">
          <span class="rt-label">Піксель {{ pixelSize }}px</span>
          <input v-model.number="pixelSize" type="range" min="4" max="80" step="2" />
        </span>
        <span v-if="effect === 'blur'" class="rt-group">
          <span class="rt-label">Сила {{ blurRadius }}px</span>
          <input v-model.number="blurRadius" type="range" min="2" max="60" step="1" />
        </span>
        <span v-if="effect === 'fill'" class="rt-group">
          <span class="rt-label">Колір</span>
          <input v-model="fillColor" type="color" class="rt-color" title="колір замазування" />
        </span>
      </div>

      <!-- Полотно -->
      <div ref="wrapEl" class="crop-stage-wrap rt-stage-wrap">
        <div
          v-show="ready"
          ref="stageEl"
          class="crop-stage rt-stage"
          :class="{ 'no-cursor': tool === 'brush' }"
          :style="stageStyle"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @pointerleave="cursorVisible = false"
          @pointerenter="cursorVisible = true"
        >
          <canvas ref="canvasEl" class="rt-canvas"></canvas>
          <div v-if="rectSel" class="crop-rect rt-rect" :style="rectStyle"></div>
          <div v-if="tool === 'brush' && cursorVisible" class="rt-cursor" :style="cursorStyle"></div>
        </div>
        <div v-if="!ready" class="crop-loading">{{ loadFailed ? 'Не вдалося завантажити зображення' : 'Завантаження зображення…' }}</div>
      </div>

      <div class="crop-toolbar">
        <button class="gen-btn" :disabled="!undoStack.length" title="крок назад (Ctrl+Z)" @click="undo"><span class="msym sm">undo</span> Назад</button>
        <button class="gen-btn" :disabled="!dirty" title="скинути всі правки цієї сесії" @click="resetAll"><span class="msym sm">restart_alt</span> Скинути</button>
        <button v-if="gen.retouched" class="gen-btn" title="повернути оригінальний кадр генерації (до всіх ретушей)" @click="restoreOriginal">
          <span class="msym sm">history</span> Відновити оригінал
        </button>
        <span class="muted mono" style="margin-left:auto">{{ natural.w }}×{{ natural.h }} px</span>
      </div>

      <div class="modal-actions">
        <button class="secondary" @click="tryClose">Закрити</button>
        <button :disabled="!dirty || saving" title="зберегти відредагований кадр у генерацію" @click="save">
          <span class="msym sm">save</span> {{ saving ? 'Зберігаю…' : 'Зберегти ретуш' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import type { Generation } from '@/types'

// Ретуш-редактор: блюр / пікселізація / замазування кистю або по прямокутній
// області. Все малюється на canvas у НАТУРАЛЬНОМУ розмірі кадру (CSS лише
// масштабує показ) — збережений результат піксель-у-піксель незалежний від вікна.
// Бібліотек не тягнемо: Chromium-канвас уміє все потрібне (ctx.filter='blur',
// downscale-пікселізацію, композитні маски) офлайн і без ваги fabric/tui.

const props = defineProps<{ gen: Generation | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void; (e: 'restored'): void }>()

const ui = useUiStore()

type Tool = 'brush' | 'rect'
type Effect = 'pixelate' | 'blur' | 'fill'
const tool = ref<Tool>('brush')
const effect = ref<Effect>('pixelate')
const brushSize = ref(80) // діаметр, px оригіналу
const pixelSize = ref(16)
const blurRadius = ref(14)
const fillColor = ref('#202124')

const wrapEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)

const natural = ref({ w: 0, h: 0 })
const disp = ref({ w: 0, h: 0 })
const loadFailed = ref(false)
const saving = ref(false)
const dirty = ref(false)
const cursorVisible = ref(false)
const cursorPos = ref({ x: 0, y: 0 }) // display px відносно stage
const rectSel = ref<{ x: number; y: number; w: number; h: number } | null>(null) // натуральні px
const undoStack = ref<HTMLCanvasElement[]>([])
const UNDO_LIMIT = 10

const ready = computed(() => natural.value.w > 0 && disp.value.w > 0 && !loadFailed.value)
const k = computed(() => (natural.value.w ? disp.value.w / natural.value.w : 0))
const stageStyle = computed(() => ({ width: disp.value.w + 'px', height: disp.value.h + 'px' }))
const rectStyle = computed(() => {
  if (!rectSel.value) return {}
  const kk = k.value
  return {
    left: rectSel.value.x * kk + 'px',
    top: rectSel.value.y * kk + 'px',
    width: rectSel.value.w * kk + 'px',
    height: rectSel.value.h * kk + 'px',
  }
})
const cursorStyle = computed(() => {
  const d = brushSize.value * k.value
  return {
    left: cursorPos.value.x - d / 2 + 'px',
    top: cursorPos.value.y - d / 2 + 'px',
    width: d + 'px',
    height: d + 'px',
  }
})

// ── полотна: work (поточний стан) + тимчасові шари штриха ──
let work: HTMLCanvasElement | null = null // актуальний стан зображення
let original: HTMLCanvasElement | null = null // незмінний кадр на момент відкриття (для «Скинути»)
let filtered: HTMLCanvasElement | null = null // повний кадр з ефектом (на час штриха)
let mask: HTMLCanvasElement | null = null // маска кисті (білі мазки)
let strokeLast: { x: number; y: number } | null = null
let undoEvicted = false // стек обрізали (UNDO_LIMIT) — до оригіналу через undo вже не дійти
let loadSeq = 0 // захист від «повільний декод попередньої генерації переміг поточну»
const confirmBusy = ref(false) // вкладений ui.confirm відкрито — глушимо Esc/повторні виклики

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = mkCanvas(src.width, src.height)
  c.getContext('2d')!.drawImage(src, 0, 0)
  return c
}

/** Повний кадр `src` з застосованим ефектом — джерело для маски/області. */
function buildFiltered(src: HTMLCanvasElement): HTMLCanvasElement {
  const W = src.width
  const H = src.height
  const out = mkCanvas(W, H)
  const ctx = out.getContext('2d')!
  if (effect.value === 'fill') {
    ctx.fillStyle = fillColor.value
    ctx.fillRect(0, 0, W, H)
  } else if (effect.value === 'pixelate') {
    const px = Math.max(2, pixelSize.value)
    const sw = Math.max(1, Math.round(W / px))
    const sh = Math.max(1, Math.round(H / px))
    const small = mkCanvas(sw, sh)
    const sctx = small.getContext('2d')!
    sctx.imageSmoothingEnabled = true
    sctx.drawImage(src, 0, 0, sw, sh)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, W, H)
  } else {
    // Блюр: спершу чистий кадр (щоб краї не «світились» прозорістю), зверху — розмитий.
    ctx.drawImage(src, 0, 0)
    ctx.filter = `blur(${blurRadius.value}px)`
    ctx.drawImage(src, 0, 0)
    ctx.filter = 'none'
  }
  return out
}

/** Перемальовує видимий canvas: work + (під час штриха) ефект крізь маску. */
function repaint(): void {
  const cv = canvasEl.value
  if (!cv || !work) return
  const ctx = cv.getContext('2d')!
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.drawImage(work, 0, 0)
  if (filtered && mask) {
    const overlay = mkCanvas(cv.width, cv.height)
    const octx = overlay.getContext('2d')!
    octx.drawImage(filtered, 0, 0)
    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(mask, 0, 0)
    ctx.drawImage(overlay, 0, 0)
  }
}

function pushUndo(): void {
  if (!work) return
  undoStack.value.push(cloneCanvas(work))
  if (undoStack.value.length > UNDO_LIMIT) {
    undoStack.value.shift()
    undoEvicted = true // дно стека вже НЕ оригінал — dirty не можна скидати по довжині
  }
}

function undo(): void {
  if (pointerId !== null) return // посеред штриха/виділення — стан штриха б розсипався
  const prev = undoStack.value.pop()
  if (!prev || !work) return
  work = prev
  dirty.value = undoEvicted || undoStack.value.length > 0
  repaint()
}

/** Повний відкат до кадру на момент відкриття (працює і після переповнення стека). */
function resetAll(): void {
  if (!original || pointerId !== null) return
  work = cloneCanvas(original)
  undoStack.value = []
  undoEvicted = false
  dirty.value = false
  repaint()
}

/** Вписує полотно у вільну область wrap (contain; апскейл максимум 2×). */
function refit(): void {
  const wrap = wrapEl.value
  if (!wrap || !natural.value.w || !natural.value.h) return
  const cs = getComputedStyle(wrap)
  const availW = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const availH = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
  if (availW <= 0 || availH <= 0) return
  const s = Math.min(availW / natural.value.w, availH / natural.value.h, 2)
  disp.value = { w: Math.max(1, Math.floor(natural.value.w * s)), h: Math.max(1, Math.floor(natural.value.h * s)) }
}
let ro: ResizeObserver | null = null

async function loadImage(): Promise<void> {
  if (!props.gen) return
  const seq = ++loadSeq
  loadFailed.value = false
  const img = new Image()
  img.src = `/api/generation-image/${props.gen.id}?t=${Date.now()}`
  try {
    await img.decode()
  } catch {
    if (seq === loadSeq) loadFailed.value = true
    return
  }
  // Поки декодувалось, могли відкрити ІНШУ генерацію — пізній результат ігноруємо.
  if (seq !== loadSeq || !props.gen) return
  natural.value = { w: img.naturalWidth, h: img.naturalHeight }
  work = mkCanvas(img.naturalWidth, img.naturalHeight)
  work.getContext('2d')!.drawImage(img, 0, 0)
  original = cloneCanvas(work)
  undoStack.value = []
  undoEvicted = false
  dirty.value = false
  await nextTick()
  if (seq !== loadSeq) return
  const cv = canvasEl.value
  if (cv) {
    cv.width = img.naturalWidth
    cv.height = img.naturalHeight
  }
  refit()
  repaint()
}

// ── вказівник: кисть (штрих з маскою) або прямокутна область ──
let pointerId: number | null = null
let rectAnchor: { x: number; y: number } | null = null

function toNatural(e: PointerEvent): { x: number; y: number } {
  const st = stageEl.value
  if (!st) return { x: 0, y: 0 }
  const r = st.getBoundingClientRect()
  const kk = r.width > 0 ? natural.value.w / r.width : 1
  return {
    x: Math.max(0, Math.min((e.clientX - r.left) * kk, natural.value.w)),
    y: Math.max(0, Math.min((e.clientY - r.top) * kk, natural.value.h)),
  }
}
function trackCursor(e: PointerEvent): void {
  const st = stageEl.value
  if (!st) return
  const r = st.getBoundingClientRect()
  cursorPos.value = { x: e.clientX - r.left, y: e.clientY - r.top }
}

function maskStamp(p: { x: number; y: number }): void {
  if (!mask) return
  const ctx = mask.getContext('2d')!
  ctx.strokeStyle = '#fff'
  ctx.fillStyle = '#fff'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = brushSize.value
  if (strokeLast) {
    ctx.beginPath()
    ctx.moveTo(strokeLast.x, strokeLast.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(p.x, p.y, brushSize.value / 2, 0, Math.PI * 2)
    ctx.fill()
  }
  strokeLast = p
}

function onPointerDown(e: PointerEvent): void {
  if (!ready.value || pointerId !== null || !work) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()
  pointerId = e.pointerId
  try {
    stageEl.value?.setPointerCapture(e.pointerId)
  } catch {
    /* not supported */
  }
  const p = toNatural(e)
  if (tool.value === 'brush') {
    pushUndo()
    filtered = buildFiltered(work)
    mask = mkCanvas(work.width, work.height)
    strokeLast = null
    maskStamp(p)
    repaint()
  } else {
    rectAnchor = p
    rectSel.value = { x: p.x, y: p.y, w: 0, h: 0 }
  }
}

function onPointerMove(e: PointerEvent): void {
  trackCursor(e)
  if (pointerId !== e.pointerId) return
  const p = toNatural(e)
  if (tool.value === 'brush' && mask) {
    maskStamp(p)
    repaint()
  } else if (tool.value === 'rect' && rectAnchor) {
    rectSel.value = {
      x: Math.min(rectAnchor.x, p.x),
      y: Math.min(rectAnchor.y, p.y),
      w: Math.abs(p.x - rectAnchor.x),
      h: Math.abs(p.y - rectAnchor.y),
    }
  }
}

function onPointerUp(e: PointerEvent): void {
  if (pointerId !== e.pointerId) return
  try {
    stageEl.value?.releasePointerCapture(e.pointerId)
  } catch {
    /* відпущено */
  }
  pointerId = null
  if (tool.value === 'brush') {
    bakeStroke()
  } else {
    applyRect()
  }
}

/** Кінець штриха: ефект крізь маску вшивається у work. */
function bakeStroke(): void {
  if (!work || !filtered || !mask) return
  const overlay = mkCanvas(work.width, work.height)
  const octx = overlay.getContext('2d')!
  octx.drawImage(filtered, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(mask, 0, 0)
  work.getContext('2d')!.drawImage(overlay, 0, 0)
  filtered = null
  mask = null
  strokeLast = null
  dirty.value = true
  repaint()
}

/** Ефект на виділеному прямокутнику. Маленьке виділення = випадковий клік. */
function applyRect(): void {
  const r = rectSel.value
  rectAnchor = null
  rectSel.value = null
  if (!work || !r || r.w < 6 || r.h < 6) return
  pushUndo()
  const f = buildFiltered(work)
  const x = Math.round(r.x)
  const y = Math.round(r.y)
  const w = Math.max(1, Math.round(r.w))
  const h = Math.max(1, Math.round(r.h))
  work.getContext('2d')!.drawImage(f, x, y, w, h, x, y, w, h)
  dirty.value = true
  repaint()
}

// ── збереження / відновлення ──
async function save(): Promise<void> {
  if (!props.gen || !work || !dirty.value) return
  saving.value = true
  try {
    await call('POST', `/api/generations/${props.gen.id}/retouch`, { image_data_url: work.toDataURL('image/png') })
    ui.toast('Ретуш збережено — кроп/застосування підуть уже з нею', 'ok')
    emit('saved')
    emit('close')
  } catch {
    /* call() вже показав тост */
  } finally {
    saving.value = false
  }
}

async function restoreOriginal(): Promise<void> {
  if (!props.gen || confirmBusy.value) return
  confirmBusy.value = true
  let ok = false
  try {
    ok = await ui.confirm({
      title: 'Відновити оригінал?',
      message: 'Кадр генерації повернеться до стану ДО всіх ретушей. Поточні незбережені правки теж зникнуть.',
      okText: 'Відновити',
      danger: true,
    })
  } finally {
    confirmBusy.value = false
  }
  if (!ok) return
  await call('POST', `/api/generations/${props.gen.id}/restore-image`)
  ui.toast('Оригінальний кадр відновлено', 'ok')
  emit('restored')
  await loadImage()
}

async function tryClose(): Promise<void> {
  if (confirmBusy.value) return
  if (dirty.value) {
    confirmBusy.value = true
    let ok = false
    try {
      ok = await ui.confirm({
        title: 'Закрити без збереження?',
        message: 'Незбережені правки ретуші буде втрачено.',
        okText: 'Закрити',
        danger: true,
      })
    } finally {
      confirmBusy.value = false
    }
    if (!ok) return
  }
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  // Поки відкритий вкладений ui.confirm — модалка не реагує (інакше Escape
  // каскадив би: закриття confirm → ще один tryClose → новий confirm).
  if (!props.gen || confirmBusy.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    void tryClose()
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  }
}

watch(
  () => props.gen,
  async (g) => {
    rectSel.value = null
    filtered = null
    mask = null
    pointerId = null
    if (g) {
      document.addEventListener('keydown', onKey, true)
      await nextTick()
      if (!ro) ro = new ResizeObserver(refit)
      if (wrapEl.value) ro.observe(wrapEl.value)
      await loadImage()
    } else {
      document.removeEventListener('keydown', onKey, true)
      ro?.disconnect()
      loadSeq++ // інвалідувати запізнілі decode()
      work = null
      original = null
      undoStack.value = []
      undoEvicted = false
      dirty.value = false
      natural.value = { w: 0, h: 0 }
      disp.value = { w: 0, h: 0 }
    }
  }
)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
  ro?.disconnect()
})
</script>
