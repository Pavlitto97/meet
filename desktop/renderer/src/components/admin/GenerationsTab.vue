<template>
  <section class="panel active">
    <div class="toolbar">
      <button class="secondary" @click="load"><span class="msym">refresh</span>Оновити</button>
      <select v-model="filterStatus" class="btn-sm" style="border-radius:16px;padding:8px 12px" @change="load">
        <option value="">усі статуси</option>
        <option value="done">done</option>
        <option value="pending">pending</option>
        <option value="error">error</option>
      </select>
      <span class="toolbar-right"></span>
      <button v-show="hasError" class="danger btn-sm" @click="bulkDel('error', 'усі генерації-помилки')"><span class="msym sm">delete</span>Видалити всі помилки</button>
      <button v-show="hasDone" class="danger btn-sm" @click="bulkDel('done', 'усі готові генерації')"><span class="msym sm">delete</span>Видалити всі done</button>
      <button v-show="generations.length" class="danger btn-sm" @click="bulkDel('all', 'ВСЮ чергу генерацій')"><span class="msym sm">delete</span>Очистити чергу</button>
    </div>

    <div class="stat-grid compact" style="margin-bottom:16px">
      <div v-for="(s, i) in stats" :key="i" class="stat-card" :class="s.cls">
        <span class="label">{{ s.label }}</span><span class="value">{{ s.value }}</span>
      </div>
    </div>

    <div class="gen-gallery">
      <div v-for="g in generations" :key="g.id" class="slot" :data-gid="g.id">
        <div class="queue-head">
          <strong>{{ g.participant_name || '—' }}</strong>
          <span class="badge" :class="badge(g).cls">{{ badge(g).label }}</span>
          <span v-if="g.degrade_pct != null" class="badge user" title="авто-деградація кодеком">кодек {{ g.degrade_pct }}%</span>
        </div>

        <div v-if="g.has_input" class="gen-compare">
          <figure class="gen-shot">
            <figcaption>оригінал</figcaption>
            <div class="preview sm" @click="openImageModal(`Оригінал — ${g.participant_name || '#' + g.id}`, `/api/generation-input/${g.id}?t=${genBust}`)">
              <img :src="`/api/generation-input/${g.id}?t=${genBust}`" />
            </div>
          </figure>
          <span class="msym gen-arrow">arrow_forward</span>
          <figure class="gen-shot">
            <figcaption>результат</figcaption>
            <div class="preview sm" @click="openGenModal(g)">
              <img v-if="g.has_image" :src="`/api/generation-image/${g.id}?t=${genBust}`" />
            </div>
          </figure>
        </div>
        <div v-else class="preview" @click="openGenModal(g)">
          <img v-if="g.has_image" :src="`/api/generation-image/${g.id}?t=${genBust}`" />
        </div>

        <div v-if="g.status === 'pending'" class="loader-bar"></div>
        <div v-else-if="g.status === 'error'" class="original">{{ g.error || '' }}</div>
        <div v-else class="original">{{ metaStr(g) }}</div>

        <div v-if="g.status === 'done' && g.has_image" class="row">
          <button class="gen-btn" @click="approveSplit(g)"><span class="msym sm">content_cut</span> Розрізати</button>
          <button class="gen-btn" title="нова картинка з того ж оригіналу й промту" @click="regen(g)"><span class="msym sm">autorenew</span> Перегенерувати</button>
          <button class="iconbtn btn-sm danger" title="видалити" @click="del(g)"><span class="msym sm">delete</span></button>
        </div>
        <div v-else-if="g.status === 'error'" class="row">
          <button class="gen-btn" @click="regen(g)"><span class="msym sm">autorenew</span> Повторити</button>
          <button class="iconbtn btn-sm danger" title="видалити" @click="del(g)"><span class="msym sm">delete</span></button>
        </div>
      </div>
    </div>

    <p v-show="!generations.length" class="muted">Генерацій немає. Запусти <span class="msym sm">auto_awesome</span> зі вкладки «Учасники».</p>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import { call } from '@/lib/api'
import { splitCollage } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import { AdminModalKey } from '@/components/admin/adminModal'
import type { Generation } from '@/types'

const ui = useUiStore()
const ENC = encodeURIComponent
const modal = inject(AdminModalKey)!

const generations = ref<Generation[]>([])
const filterStatus = ref('')
const genBust = ref(Date.now())

const hasError = computed(() => generations.value.some((g) => g.status === 'error'))
const hasDone = computed(() => generations.value.some((g) => g.status === 'done'))

const stats = computed(() => {
  const list = generations.value
  const done = list.filter((g) => g.status === 'done').length
  const pend = list.filter((g) => g.status === 'pending').length
  const err = list.filter((g) => g.status === 'error').length
  const cost = list.reduce((a, g) => a + (Number(g.cost_usd) || 0), 0)
  return [
    { label: 'Усього', value: list.length, cls: 'accent' },
    { label: 'Готово', value: done, cls: 'ok' },
    { label: 'В обробці', value: pend, cls: '' },
    { label: 'Помилок', value: err, cls: err ? 'err' : '' },
    { label: 'Сума', value: `$${cost.toFixed(5)}`, cls: '' },
  ]
})

function isEmptyImage(g: Generation): boolean {
  return g.status === 'error' && /image_url|не повернула зображення/.test(g.error || '')
}
function badge(g: Generation): { cls: string; label: string } {
  if (g.status === 'done') return { cls: 'done', label: 'готово' }
  if (isEmptyImage(g)) return { cls: 'pending', label: 'порожньо — повтори' }
  if (g.status === 'error') return { cls: 'err', label: 'помилка' }
  return { cls: 'pending', label: 'в обробці' }
}
function metaStr(g: Generation): string {
  return [g.model, g.provider, g.service_tier, g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : '']
    .filter(Boolean)
    .join(' · ')
}

// ── poll ──
let timer: ReturnType<typeof setInterval> | null = null
function startPoll(): void {
  if (timer) return
  timer = setInterval(load, 2500)
}
function stopPoll(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

async function load(): Promise<void> {
  const list = await call<Generation[]>('GET', '/api/generations' + (filterStatus.value ? `?status=${filterStatus.value}` : ''))
  generations.value = list
  genBust.value = Date.now()
  if (!list.some((g) => g.status === 'pending')) stopPoll()
}

async function del(g: Generation): Promise<void> {
  await call('DELETE', `/api/generations/${g.id}`)
  ui.toast('Видалено', 'ok')
  await load()
}
async function regen(g: Generation): Promise<void> {
  const r = await call<{ id: number }>('POST', `/api/generations/${g.id}/regenerate`)
  ui.toast(`Перегенерація #${r.id} — з того ж оригіналу`, 'ok')
  startPoll()
}
async function approveSplit(g: Generation): Promise<void> {
  if (!g.participant_id) {
    ui.toast('Генерація не привʼязана до учасника', 'err')
    return
  }
  const { left, right, split } = await splitCollage(`/api/generation-image/${g.id}?t=${Date.now()}`)
  await call('PUT', `/api/participants/${ENC(g.participant_id)}`, { avatar_data_url: left, avatar_end_data_url: right })
  await call('DELETE', `/api/generations/${g.id}`)
  ui.toast(split === 'vertical' ? 'Розрізано: верх→початок, низ→кінець' : 'Розрізано: ліве→початок, праве→кінець', 'ok')
  await load()
}
async function bulkDel(scope: 'error' | 'done' | 'all', label: string): Promise<void> {
  const ok = await ui.confirm({ title: 'Підтвердь видалення', message: `Видалити ${label}?`, okText: 'Видалити', danger: true })
  if (!ok) return
  const r = await call<{ deleted: number }>('POST', '/api/generations/bulk-delete', { scope })
  ui.toast(`Видалено: ${r.deleted}`, 'ok')
  await load()
}

// ── modals ──
function openImageModal(title: string, src: string): void {
  modal.open({ title, imgSrc: src, actions: [{ label: 'Закрити', cls: 'secondary', onClick: () => modal.close() }] })
}
function openGenModal(g: Generation): void {
  const meta = [
    `модель: ${g.model}`,
    `провайдер: ${g.provider}`,
    `тариф: ${g.service_tier}`,
    g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : '',
    g.prompt_tokens ? `tokens in: ${g.prompt_tokens}` : '',
    g.output_tokens ? `tokens out: ${g.output_tokens}` : '',
  ].filter(Boolean)

  const actions = [
    { label: 'Закрити', cls: 'secondary', onClick: () => modal.close() },
    {
      label: 'Видалити',
      cls: 'reject',
      onClick: async () => {
        await call('DELETE', `/api/generations/${g.id}`)
        modal.close()
        await load()
      },
    },
  ]
  if (g.status === 'done' && g.has_image && g.participant_id) {
    actions.push({
      label: '→ Початок',
      cls: 'secondary',
      onClick: async () => {
        await call('POST', `/api/generations/${g.id}/approve`, { which: 'start' })
        modal.close()
        ui.toast('Прийнято як аватар (початок)', 'ok')
        await load()
      },
    })
    actions.push({
      label: '→ Кінець',
      cls: 'secondary',
      onClick: async () => {
        await call('POST', `/api/generations/${g.id}/approve`, { which: 'end' })
        modal.close()
        ui.toast('Прийнято як аватар (кінець)', 'ok')
        await load()
      },
    })
    actions.push({
      label: 'Розрізати (початок + кінець)',
      cls: '',
      onClick: async () => {
        await approveSplit(g)
        modal.close()
      },
    })
  } else if (g.status === 'error') {
    actions.push({
      label: 'Повторити',
      cls: '',
      onClick: async () => {
        await call('POST', `/api/generations/${g.id}/regenerate`)
        modal.close()
        startPoll()
      },
    })
  }

  modal.open({
    title: 'Перегляд генерації',
    imgSrc: g.has_image ? `/api/generation-image/${g.id}?t=${genBust.value}` : undefined,
    meta,
    actions,
  })
}

onMounted(async () => {
  await load()
  startPoll()
})
onBeforeUnmount(stopPoll)
</script>
