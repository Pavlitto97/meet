<template>
  <section class="panel active">
    <div class="toolbar">
      <!-- Лише пропорція еталонного скріншота (2555×1267 ≈ сцена шаблону 2560×1271):
           16:9 (1920×1080) розтягував картинку по вертикалі на ~13%. -->
      <select v-model="shotSize" class="btn-sm" style="border-radius:16px;padding:8px 12px" title="Всі розміри — у рідній пропорції шаблону (без розтягування)">
        <option value="2555x1267">2555×1267 — еталон (1:1)</option>
        <option value="1920x952">1920×952 — менший, та сама пропорція</option>
        <option value="1280x635">1280×635 — компактний</option>
      </select>
      <button :disabled="capturing" @click="capture('start')"><span class="msym">photo_camera</span>Скріншот початку зустрічі</button>
      <button :disabled="capturing" @click="capture('end')"><span class="msym">photo_camera</span>Скріншот кінця зустрічі</button>
      <button class="secondary" @click="load"><span class="msym">refresh</span>Оновити</button>
      <span class="toolbar-right"></span>
      <button v-show="startCount" class="danger btn-sm" @click="bulkDel('start', 'усі скріни «початок»')"><span class="msym sm">delete</span>Усі «початок»</button>
      <button v-show="endCount" class="danger btn-sm" @click="bulkDel('end', 'усі скріни «кінець»')"><span class="msym sm">delete</span>Усі «кінець»</button>
      <button v-show="screenshots.length" class="danger btn-sm" @click="bulkDel('all', 'ВСЮ історію скрінів')"><span class="msym sm">delete</span>Очистити історію</button>
    </div>

    <p class="hint" style="margin:0 0 16px">
      Скрін знімається з рендеру <b>активної групи</b><template v-if="activeGroup"> — зараз це «<b>{{ activeGroup.name }}</b>»</template>.
      Змінити активну групу можна на вкладці «Групи».
    </p>

    <div class="stat-grid compact" style="margin-bottom:16px">
      <div class="stat-card accent"><span class="label">Усього</span><span class="value">{{ screenshots.length }}</span></div>
      <div class="stat-card ok"><span class="label">Початок</span><span class="value">{{ startCount }}</span></div>
      <div class="stat-card"><span class="label">Кінець</span><span class="value">{{ endCount }}</span></div>
    </div>

    <div class="shot-gallery">
      <div v-for="s in screenshots" :key="s.id" class="slot shot-card" :data-sid="s.id">
        <div class="queue-head">
          <strong>#{{ s.id }}</strong>
          <span class="badge" :class="s.which === 'end' ? 'pending' : 'done'">{{ s.which === 'end' ? 'кінець' : 'початок' }}</span>
          <span class="muted mono" style="margin-left:auto">{{ s.width }}×{{ s.height }}</span>
        </div>
        <div class="preview" @click="openShotModal(s)">
          <img :src="`/api/screenshot-image/${s.id}?t=${bust}`" loading="lazy" />
        </div>
        <div class="original">{{ sub(s) }}</div>
        <div class="row">
          <button class="gen-btn" @click="dl(s.id)"><span class="msym sm">download</span> Завантажити</button>
          <button class="iconbtn btn-sm" title="збільшити" @click="openShotModal(s)"><span class="msym sm">zoom_in</span></button>
          <button class="iconbtn btn-sm danger" title="видалити" @click="del(s)"><span class="msym sm">delete</span></button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { call } from '@/lib/api'
import { fmtBytes } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import { AdminModalKey } from '@/components/admin/adminModal'
import type { Group, Screenshot } from '@/types'

const ui = useUiStore()
const modal = inject(AdminModalKey)!

const screenshots = ref<Screenshot[]>([])
const activeGroup = ref<Group | null>(null)
// Дефолт — еталонна пропорція шаблону 1:1 (2555×1267, без масштабування/розтягування).
const shotSize = ref('2555x1267')
const capturing = ref(false)
const bust = ref(Date.now())

const endCount = computed(() => screenshots.value.filter((s) => s.which === 'end').length)
const startCount = computed(() => screenshots.value.length - endCount.value)

function sub(s: Screenshot): string {
  return [s.created_at, fmtBytes(s.size_bytes), s.group_name, s.meeting_code, s.label].filter(Boolean).join(' · ')
}
function parseSize(): { width: number; height: number } {
  const [w, h] = (shotSize.value || '2555x1267').split('x').map(Number)
  return { width: w || 2555, height: h || 1267 }
}

async function load(): Promise<void> {
  const [list, groups] = await Promise.all([call<Screenshot[]>('GET', '/api/screenshots'), call<Group[]>('GET', '/api/groups')])
  screenshots.value = list
  activeGroup.value = groups.find((g) => g.active) ?? null
  bust.value = Date.now()
}

async function capture(which: 'start' | 'end'): Promise<void> {
  if (capturing.value) return
  capturing.value = true
  const { width, height } = parseSize()
  ui.toast(`Роблю скрін (${which === 'end' ? 'кінець' : 'початок'}, ${width}×${height})…`)
  try {
    const r = await call<{ id: number; size_bytes: number }>('POST', '/api/screenshots', { which, width, height })
    ui.toast(`Скрін #${r.id} готовий (${fmtBytes(r.size_bytes)})`, 'ok')
    await load()
  } catch {
    /* call() already toasted */
  } finally {
    capturing.value = false
  }
}

function dl(id: number): void {
  window.location.href = `/api/screenshot-image/${id}?download=1`
}
async function del(s: Screenshot): Promise<void> {
  await call('DELETE', `/api/screenshots/${s.id}`)
  ui.toast('Видалено', 'ok')
  await load()
}
async function bulkDel(scope: 'start' | 'end' | 'all', label: string): Promise<void> {
  const ok = await ui.confirm({ title: 'Підтвердь видалення', message: `Видалити ${label}?`, okText: 'Видалити', danger: true })
  if (!ok) return
  const r = await call<{ deleted: number }>('POST', '/api/screenshots/bulk-delete', { scope })
  ui.toast(`Видалено: ${r.deleted}`, 'ok')
  await load()
}

function openShotModal(s: Screenshot): void {
  modal.open({
    title: `Скрін #${s.id} — ${s.which === 'end' ? 'кінець' : 'початок'}`,
    imgSrc: `/api/screenshot-image/${s.id}?t=${bust.value}`,
    meta: [
      `${s.width}×${s.height}`,
      fmtBytes(s.size_bytes),
      s.group_name ? `група: ${s.group_name}` : '',
      s.meeting_code ? `код: ${s.meeting_code}` : '',
      s.created_at ? String(s.created_at) : '',
    ].filter(Boolean),
    actions: [
      { label: 'Закрити', cls: 'secondary', onClick: () => modal.close() },
      { label: 'Завантажити', cls: '', onClick: () => dl(s.id) },
      {
        label: 'Видалити',
        cls: 'reject',
        onClick: async () => {
          await call('DELETE', `/api/screenshots/${s.id}`)
          modal.close()
          ui.toast('Видалено', 'ok')
          await load()
        },
      },
    ],
  })
}

onMounted(load)
</script>
