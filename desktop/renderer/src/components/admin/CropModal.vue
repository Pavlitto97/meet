<template>
  <div v-if="gen" class="modal-bg show" @mousedown.self="$emit('close')">
    <div class="modal crop-modal" role="dialog" aria-modal="true">
      <h3><span class="msym">crop</span> Генерація #{{ gen.id }} — {{ gen.participant_name || '—' }}</h3>
      <div class="gen-meta">
        <span v-if="gen.group_name">група: {{ gen.group_name }}</span>
        <span>{{ gen.model }} · {{ gen.provider }} · {{ gen.service_tier }}</span>
        <span v-if="gen.cost_usd != null">${{ Number(gen.cost_usd).toFixed(5) }}</span>
        <span v-if="gen.approved_at" class="badge applied">застосовано</span>
        <span class="crop-head-hint">тягни мишею по фото — рамка; за маркери — розмір; подвійний клік — все; стрілки — посунути</span>
      </div>

      <div ref="wrapEl" class="crop-stage-wrap">
        <div
          v-show="ready"
          ref="stageEl"
          class="crop-stage"
          :style="stageStyle"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @dblclick.prevent="presetFull"
        >
          <img ref="imgEl" :src="imgSrc" draggable="false" alt="" @load="onImgLoad" @error="loadFailed = true" />
          <div v-if="!sel" class="crop-empty-hint"><span>Затисни і протягни мишею, щоб виділити область</span></div>
          <div v-if="sel" class="crop-rect" :style="rectStyle">
            <div class="crop-grid"></div>
            <span v-for="hd in HANDLES" :key="hd" class="crop-h" :class="'crop-h-' + hd" :data-h="hd"></span>
            <span class="crop-size-badge" :class="badgeClass">{{ naturalSel.width }}×{{ naturalSel.height }}</span>
          </div>
        </div>
        <div v-if="!ready" class="crop-loading">{{ loadFailed ? 'Не вдалося завантажити зображення' : 'Завантаження зображення…' }}</div>
      </div>

      <div class="crop-toolbar">
        <span class="crop-presets">
          <button class="gen-btn" :disabled="!ready" @click="presetHalf('first')">{{ tall ? 'Верхня половина' : 'Ліва половина' }}</button>
          <button class="gen-btn" :disabled="!ready" @click="presetHalf('second')">{{ tall ? 'Нижня половина' : 'Права половина' }}</button>
          <button class="gen-btn" :disabled="!ready" @click="presetFull">Все зображення</button>
          <button v-if="sel" class="gen-btn" @click="sel = null"><span class="msym sm">close</span> Скинути</button>
        </span>
        <span v-if="sel" class="muted mono crop-size">{{ naturalSel.width }}×{{ naturalSel.height }} px · x {{ naturalSel.x }} · y {{ naturalSel.y }}</span>
      </div>

      <!-- Підтвердження: куди йде виділена область -->
      <div class="modal-actions crop-confirm">
        <button class="secondary" @click="$emit('close')">Закрити</button>
        <span class="crop-confirm-label" :class="{ muted: !sel }">{{ sel ? 'Виділене — аватарка для:' : 'Спершу виділи область' }}</span>
        <button
          :disabled="!sel || applying"
          :class="{ applied: applied.start }"
          title="підтвердити: виділена область стане аватаркою ПОЧАТКУ зустрічі"
          @click="apply('start')"
        >
          <span class="msym sm">{{ applied.start ? 'check_circle' : 'line_start_circle' }}</span> Початок зустрічі
        </button>
        <button
          :disabled="!sel || applying"
          :class="{ applied: applied.end }"
          title="підтвердити: виділена область стане аватаркою КІНЦЯ зустрічі"
          @click="apply('end')"
        >
          <span class="msym sm">{{ applied.end ? 'check_circle' : 'line_end_circle' }}</span> Кінець зустрічі
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

const props = defineProps<{ gen: Generation | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'applied', which: 'start' | 'end'): void }>()

const ui = useUiStore()
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
type Handle = (typeof HANDLES)[number]
type Rect = { x: number; y: number; w: number; h: number }
const MIN_SEL = 8 // мінімум серверного кропу (px оригіналу); менше = випадковий клік

const wrapEl = ref<HTMLElement | null>(null)
const stageEl = ref<HTMLElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)

const natural = ref({ w: 0, h: 0 }) // справжній розмір зображення
const disp = ref({ w: 0, h: 0 }) // показаний розмір (вписаний у wrap, рахує refit())
// Виділення у ПІКСЕЛЯХ ОРИГІНАЛУ — не пливе при ресайзі вікна/модалки.
const sel = ref<Rect | null>(null)
const applying = ref(false)
const loadFailed = ref(false)
const applied = ref({ start: false, end: false })

const imgSrc = computed(() => (props.gen ? `/api/generation-image/${props.gen.id}?t=${props.gen.id}` : ''))
const tall = computed(() => natural.value.w > 0 && natural.value.h / natural.value.w > 1.3)
const ready = computed(() => natural.value.w > 0 && disp.value.w > 0 && !loadFailed.value)
const k = computed(() => (natural.value.w ? disp.value.w / natural.value.w : 0))

const stageStyle = computed(() => ({ width: disp.value.w + 'px', height: disp.value.h + 'px' }))
const rectStyle = computed(() => {
  if (!sel.value) return {}
  const kk = k.value
  return {
    left: sel.value.x * kk + 'px',
    top: sel.value.y * kk + 'px',
    width: sel.value.w * kk + 'px',
    height: sel.value.h * kk + 'px',
  }
})
const naturalSel = computed(() => {
  if (!sel.value) return { x: 0, y: 0, width: 0, height: 0 }
  return {
    x: Math.round(sel.value.x),
    y: Math.round(sel.value.y),
    width: Math.round(sel.value.w),
    height: Math.round(sel.value.h),
  }
})
/** Бейдж розміру: всередині рамки, а малій рамці — під/над нею. */
const badgeClass = computed(() => {
  if (!sel.value) return 'in'
  const kk = k.value
  if (sel.value.w * kk >= 92 && sel.value.h * kk >= 34) return 'in'
  if ((sel.value.y + sel.value.h) * kk + 28 <= disp.value.h) return 'below'
  return 'above'
})

/** Вписує зображення у вільну область wrap (contain; апскейл максимум 2×). */
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

function onImgLoad(): void {
  const el = imgEl.value
  if (!el) return
  natural.value = { w: el.naturalWidth, h: el.naturalHeight }
  loadFailed.value = false
  refit()
  // Виділення НЕ створюємо: користувач сам обирає область (або пресетом).
}

// ── drag-машина на Pointer Events із захватом: draw / move / resize-за-маркер ──
let mode: 'draw' | 'move' | Handle | null = null
let pointerId: number | null = null
let anchor = { x: 0, y: 0 } // натуральні px
let startSel: Rect = { x: 0, y: 0, w: 0, h: 0 }

/** Координати події у пікселях оригіналу (через живий rect — стійко до анімацій). */
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

function onPointerDown(e: PointerEvent): void {
  if (!ready.value || mode) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  e.preventDefault()
  const t = e.target as HTMLElement
  anchor = toNatural(e)
  const hd = (t.dataset?.h as Handle | undefined) || undefined
  if (hd && sel.value) {
    mode = hd
    startSel = { ...sel.value }
  } else if (sel.value && t.closest('.crop-rect')) {
    mode = 'move'
    startSel = { ...sel.value }
  } else {
    mode = 'draw'
    sel.value = { x: anchor.x, y: anchor.y, w: 0, h: 0 }
  }
  pointerId = e.pointerId
  try {
    stageEl.value?.setPointerCapture(e.pointerId) // drag не губиться поза вікном
  } catch {
    /* not supported — деградує до звичайних подій */
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!mode || e.pointerId !== pointerId || !sel.value) return
  const p = toNatural(e)
  const W = natural.value.w
  const H = natural.value.h
  if (mode === 'draw') {
    sel.value = {
      x: Math.min(anchor.x, p.x),
      y: Math.min(anchor.y, p.y),
      w: Math.abs(p.x - anchor.x),
      h: Math.abs(p.y - anchor.y),
    }
  } else if (mode === 'move') {
    sel.value = {
      ...startSel,
      x: Math.max(0, Math.min(startSel.x + (p.x - anchor.x), W - startSel.w)),
      y: Math.max(0, Math.min(startSel.y + (p.y - anchor.y), H - startSel.h)),
    }
  } else {
    // ресайз: рухаються лише грані з літер маркера; перетягування «через» — фліп
    let x1 = startSel.x
    let y1 = startSel.y
    let x2 = startSel.x + startSel.w
    let y2 = startSel.y + startSel.h
    if (mode.includes('w')) x1 = p.x
    if (mode.includes('e')) x2 = p.x
    if (mode.includes('n')) y1 = p.y
    if (mode.includes('s')) y2 = p.y
    sel.value = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
  }
}

function onPointerUp(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return
  endDrag()
}
function endDrag(): void {
  if (pointerId != null) {
    try {
      stageEl.value?.releasePointerCapture(pointerId)
    } catch {
      /* pointer уже відпущено */
    }
  }
  pointerId = null
  // випадковий клік/мікро-рух → не лишаємо незастосовне виділення
  if (mode && sel.value && (sel.value.w < MIN_SEL || sel.value.h < MIN_SEL)) sel.value = null
  mode = null
}

function presetHalf(part: 'first' | 'second'): void {
  const { w: W, h: H } = natural.value
  if (!W || !H) return
  sel.value = tall.value
    ? { x: 0, y: part === 'first' ? 0 : H / 2, w: W, h: H / 2 }
    : { x: part === 'first' ? 0 : W / 2, y: 0, w: W / 2, h: H }
}
function presetFull(): void {
  const { w: W, h: H } = natural.value
  if (W && H) sel.value = { x: 0, y: 0, w: W, h: H }
}

async function apply(which: 'start' | 'end'): Promise<void> {
  if (!props.gen || !sel.value) return
  applying.value = true
  try {
    await call('POST', `/api/generations/${props.gen.id}/crop`, { which, ...naturalSel.value })
    applied.value[which] = true
    ui.toast(which === 'start' ? 'Вирізано → аватарка початку зустрічі' : 'Вирізано → аватарка кінця зустрічі', 'ok')
    emit('applied', which)
  } catch {
    /* call() вже показав тост */
  } finally {
    applying.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  if (!props.gen) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (!sel.value || !ready.value) return
  const step = e.shiftKey ? 10 : 1
  let dx = 0
  let dy = 0
  if (e.key === 'ArrowLeft') dx = -step
  else if (e.key === 'ArrowRight') dx = step
  else if (e.key === 'ArrowUp') dy = -step
  else if (e.key === 'ArrowDown') dy = step
  else return
  e.preventDefault()
  const s = sel.value
  sel.value = {
    ...s,
    x: Math.max(0, Math.min(s.x + dx, natural.value.w - s.w)),
    y: Math.max(0, Math.min(s.y + dy, natural.value.h - s.h)),
  }
}

watch(
  () => props.gen,
  async (g) => {
    sel.value = null
    applied.value = { start: false, end: false }
    loadFailed.value = false
    natural.value = { w: 0, h: 0 }
    disp.value = { w: 0, h: 0 }
    endDrag()
    if (g) {
      document.addEventListener('keydown', onKey, true)
      await nextTick()
      if (!ro) ro = new ResizeObserver(refit)
      if (wrapEl.value) ro.observe(wrapEl.value)
    } else {
      document.removeEventListener('keydown', onKey, true)
      ro?.disconnect()
    }
  }
)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
  ro?.disconnect()
  endDrag()
})
</script>
