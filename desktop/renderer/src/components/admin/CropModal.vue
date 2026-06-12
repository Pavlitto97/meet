<template>
  <div v-if="gen" class="modal-bg show" @mousedown.self="$emit('close')">
    <div class="modal crop-modal" role="dialog" aria-modal="true">
      <h3><span class="msym">crop</span> Генерація #{{ gen.id }} — {{ gen.participant_name || '—' }}</h3>
      <div class="gen-meta">
        <span v-if="gen.group_name">група: {{ gen.group_name }}</span>
        <span>{{ gen.model }} · {{ gen.provider }} · {{ gen.service_tier }}</span>
        <span v-if="gen.cost_usd != null">${{ Number(gen.cost_usd).toFixed(5) }}</span>
        <span v-if="gen.approved_at" class="badge applied">застосовано</span>
      </div>

      <div class="crop-stage-wrap">
        <div ref="stageEl" class="crop-stage" @mousedown.prevent="startDraw">
          <img ref="imgEl" :src="imgSrc" draggable="false" alt="" @load="onImgLoad" />
          <div v-if="!sel" class="crop-empty-hint">Виділи область мишею — або скористайся пресетом нижче</div>
          <div v-if="sel" class="crop-rect" :style="rectStyle" @mousedown.stop.prevent="startMove">
            <span v-for="hd in HANDLES" :key="hd" class="crop-h" :class="'crop-h-' + hd" @mousedown.stop.prevent="startResize(hd, $event)"></span>
          </div>
        </div>
      </div>

      <div class="crop-toolbar">
        <span class="crop-presets">
          <button class="gen-btn" @click="presetHalf('first')">{{ tall ? 'Верхня половина' : 'Ліва половина' }}</button>
          <button class="gen-btn" @click="presetHalf('second')">{{ tall ? 'Нижня половина' : 'Права половина' }}</button>
          <button class="gen-btn" @click="presetFull">Все зображення</button>
        </span>
        <span v-if="sel" class="muted mono crop-size">{{ naturalSel.width }}×{{ naturalSel.height }} px</span>
      </div>

      <!-- Підтвердження: куди йде виділена область -->
      <div class="modal-actions crop-confirm">
        <button class="secondary" @click="$emit('close')">Закрити</button>
        <span class="crop-confirm-label" :class="{ muted: !sel }">{{ sel ? 'Це кроп для:' : 'Спершу виділи область' }}</span>
        <button :disabled="!sel || applying" title="підтвердити: виділена область стане аватаркою ПОЧАТКУ зустрічі" @click="apply('start')">
          <span class="msym sm">line_start_circle</span> Початок зустрічі
        </button>
        <button :disabled="!sel || applying" title="підтвердити: виділена область стане аватаркою КІНЦЯ зустрічі" @click="apply('end')">
          <span class="msym sm">line_end_circle</span> Кінець зустрічі
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import type { Generation } from '@/types'

const props = defineProps<{ gen: Generation | null }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'applied', which: 'start' | 'end'): void }>()

const ui = useUiStore()
const HANDLES = ['nw', 'ne', 'sw', 'se'] as const
type Handle = (typeof HANDLES)[number]

const stageEl = ref<HTMLElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
// Виділення у ДИСПЛЕЙНИХ пікселях відносно stage (stage = розмір показаної картинки).
const sel = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const natural = ref({ w: 0, h: 0 })
const applying = ref(false)

const imgSrc = computed(() => (props.gen ? `/api/generation-image/${props.gen.id}?t=${props.gen.id}` : ''))
const tall = computed(() => natural.value.w > 0 && natural.value.h / natural.value.w > 1.3)

const scale = computed(() => {
  const el = imgEl.value
  if (!el || !el.clientWidth) return 1
  return natural.value.w / el.clientWidth
})
const naturalSel = computed(() => {
  if (!sel.value) return { x: 0, y: 0, width: 0, height: 0 }
  const k = scale.value
  return {
    x: Math.round(sel.value.x * k),
    y: Math.round(sel.value.y * k),
    width: Math.round(sel.value.w * k),
    height: Math.round(sel.value.h * k),
  }
})
const rectStyle = computed(() =>
  sel.value
    ? { left: sel.value.x + 'px', top: sel.value.y + 'px', width: sel.value.w + 'px', height: sel.value.h + 'px' }
    : {}
)

function onImgLoad(): void {
  const el = imgEl.value
  if (!el) return
  natural.value = { w: el.naturalWidth, h: el.naturalHeight }
  // Виділення НЕ створюємо: користувач сам обирає область (або пресетом).
}

function stageBounds(): { w: number; h: number } {
  const el = imgEl.value
  return { w: el?.clientWidth ?? 0, h: el?.clientHeight ?? 0 }
}
function clampSel(s: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const b = stageBounds()
  const w = Math.max(8, Math.min(s.w, b.w))
  const h = Math.max(8, Math.min(s.h, b.h))
  return { x: Math.max(0, Math.min(s.x, b.w - w)), y: Math.max(0, Math.min(s.y, b.h - h)), w, h }
}
function pos(e: MouseEvent): { x: number; y: number } {
  const r = stageEl.value!.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}

// ── drag-машина: draw (нове виділення) / move / resize-за-кут ──
let mode: 'draw' | 'move' | Handle | null = null
let startPt = { x: 0, y: 0 }
let startSel = { x: 0, y: 0, w: 0, h: 0 }

function beginDrag(m: typeof mode, e: MouseEvent): void {
  mode = m
  startPt = pos(e)
  if (sel.value) startSel = { ...sel.value }
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', endDrag)
}
function startDraw(e: MouseEvent): void {
  const p = pos(e)
  sel.value = { x: p.x, y: p.y, w: 1, h: 1 }
  beginDrag('draw', e)
}
function startMove(e: MouseEvent): void {
  if (sel.value) beginDrag('move', e)
}
function startResize(h: Handle, e: MouseEvent): void {
  if (sel.value) beginDrag(h, e)
}
function onDrag(e: MouseEvent): void {
  if (!mode || !sel.value) return
  const p = pos(e)
  const dx = p.x - startPt.x
  const dy = p.y - startPt.y
  const b = stageBounds()
  if (mode === 'draw') {
    const x1 = Math.max(0, Math.min(startPt.x, p.x))
    const y1 = Math.max(0, Math.min(startPt.y, p.y))
    const x2 = Math.min(b.w, Math.max(startPt.x, p.x))
    const y2 = Math.min(b.h, Math.max(startPt.y, p.y))
    sel.value = { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) }
  } else if (mode === 'move') {
    sel.value = clampSel({ ...startSel, x: startSel.x + dx, y: startSel.y + dy })
  } else {
    // ресайз за кут: протилежний кут зафіксований
    let { x, y, w, h } = startSel
    if (mode.includes('w')) { x = startSel.x + dx; w = startSel.w - dx }
    if (mode.includes('e')) { w = startSel.w + dx }
    if (mode.includes('n')) { y = startSel.y + dy; h = startSel.h - dy }
    if (mode.includes('s')) { h = startSel.h + dy }
    if (w < 0) { x += w; w = -w }
    if (h < 0) { y += h; h = -h }
    sel.value = clampSel({ x, y, w: Math.max(8, w), h: Math.max(8, h) })
  }
}
function endDrag(): void {
  mode = null
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', endDrag)
  // випадковий клік без руху → не лишаємо 1×1-виділення
  if (sel.value && (sel.value.w < 4 || sel.value.h < 4)) sel.value = null
}

function presetHalf(part: 'first' | 'second'): void {
  const b = stageBounds()
  if (!b.w || !b.h) return
  sel.value = tall.value
    ? { x: 0, y: part === 'first' ? 0 : b.h / 2, w: b.w, h: b.h / 2 }
    : { x: part === 'first' ? 0 : b.w / 2, y: 0, w: b.w / 2, h: b.h }
}
function presetFull(): void {
  const b = stageBounds()
  if (b.w && b.h) sel.value = { x: 0, y: 0, w: b.w, h: b.h }
}

async function apply(which: 'start' | 'end'): Promise<void> {
  if (!props.gen || !sel.value) return
  applying.value = true
  try {
    await call('POST', `/api/generations/${props.gen.id}/crop`, { which, ...naturalSel.value })
    ui.toast(which === 'start' ? 'Вирізано → аватарка початку зустрічі' : 'Вирізано → аватарка кінця зустрічі', 'ok')
    emit('applied', which)
  } catch {
    /* call() already toasted */
  } finally {
    applying.value = false
  }
}

function onKey(e: KeyboardEvent): void {
  if (props.gen && e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
watch(
  () => props.gen,
  (g) => {
    if (g) {
      sel.value = null
      document.addEventListener('keydown', onKey, true)
    } else {
      document.removeEventListener('keydown', onKey, true)
    }
  }
)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey, true)
  endDrag()
})
</script>
