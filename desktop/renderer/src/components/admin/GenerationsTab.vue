<template>
  <section class="panel active">
    <div class="toolbar">
      <button class="secondary" @click="load"><span class="msym">refresh</span>Оновити</button>
      <select v-model="filterGroup" class="btn-sm" style="border-radius:16px;padding:8px 12px" @change="onGroupFilter">
        <option value="">усі групи</option>
        <option v-for="g in groups" :key="g.id" :value="String(g.id)">{{ g.name }}</option>
      </select>
      <select v-model="filterParticipant" class="btn-sm" style="border-radius:16px;padding:8px 12px" @change="load">
        <option value="">усі учасники</option>
        <option v-for="p in filterParticipants" :key="p.id" :value="String(p.id)">{{ p.custom_name || p.original_name }}</option>
      </select>
      <select v-model="filterStatus" class="btn-sm" style="border-radius:16px;padding:8px 12px" @change="load">
        <option value="">усі статуси</option>
        <option value="done">готові</option>
        <option value="pending">в обробці</option>
        <option value="error">помилки</option>
      </select>
      <span class="toolbar-right"></span>
      <button v-show="hasError" class="danger btn-sm" @click="bulkDel('error', 'усі генерації-помилки')"><span class="msym sm">delete</span>Видалити всі помилки</button>
      <button v-show="generations.length" class="danger btn-sm" @click="bulkDel('all', 'ВСЮ історію генерацій')"><span class="msym sm">delete</span>Очистити історію</button>
    </div>

    <div class="stat-grid compact" style="margin-bottom:16px">
      <div v-for="(s, i) in stats" :key="i" class="stat-card" :class="s.cls">
        <span class="label">{{ s.label }}</span><span class="value">{{ s.value }}</span>
      </div>
    </div>

    <div class="gen-gallery">
      <div v-for="g in generations" :key="g.id" class="slot" :class="{ 'is-applied': g.approved_at }" :data-gid="g.id">
        <div class="queue-head">
          <span v-if="g.group_name" class="badge group" :title="`група: ${g.group_name}`">{{ g.group_name }}</span>
          <strong>{{ g.participant_name || '—' }}</strong>
          <span class="badge" :class="badge(g).cls">{{ badge(g).label }}</span>
          <span v-if="g.approved_at" class="badge applied" title="цей колаж зараз стоїть аватарками учасника">застосовано</span>
          <span v-if="g.degrade_pct != null" class="badge user" title="авто-деградація кодеком">кодек {{ g.degrade_pct }}%</span>
          <span v-if="g.retouched" class="badge user" title="кадр ретушовано (блюр/пікселі/замазування); оригінал збережено">ретуш</span>
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
            <figcaption>початок | кінець</figcaption>
            <div class="preview sm" :title="g.status === 'done' && g.has_image ? 'відкрити: виділити область і підтвердити кроп' : ''" @click="openResult(g)">
              <img v-if="g.has_image" :src="`/api/generation-image/${g.id}?t=${genBust}`" />
            </div>
          </figure>
        </div>
        <div v-else class="preview" @click="openResult(g)">
          <img v-if="g.has_image" :src="`/api/generation-image/${g.id}?t=${genBust}`" />
        </div>

        <div v-if="g.status === 'pending'" class="loader-bar"></div>
        <div v-else-if="g.status === 'error'" class="original">{{ g.error || '' }}</div>
        <div v-else class="original">{{ metaStr(g) }}</div>

        <div v-if="g.status === 'done' && g.has_image" class="row">
          <button class="gen-btn" title="розрізати колаж і поставити аватарками початку та кінця" @click="apply(g)"><span class="msym sm">done_all</span> Застосувати</button>
          <button class="gen-btn" title="вручну виділити область для початку/кінця (зрізати білі рамки)" @click="cropGen = g"><span class="msym sm">crop</span> Кроп</button>
          <button class="gen-btn" title="замазати/розмити/запікселити частину кадру (кисть або область)" @click="retouchGen = g"><span class="msym sm">brush</span> Ретуш</button>
          <button class="gen-btn" title="нова генерація з оригінального фото учасника" @click="regen(g)"><span class="msym sm">autorenew</span> Перегенерувати</button>
          <button class="iconbtn btn-sm danger" title="видалити" @click="del(g)"><span class="msym sm">delete</span></button>
        </div>
        <div v-else-if="g.status === 'error'" class="row">
          <button class="gen-btn" @click="regen(g)"><span class="msym sm">autorenew</span> Повторити</button>
          <button class="iconbtn btn-sm danger" title="видалити" @click="del(g)"><span class="msym sm">delete</span></button>
        </div>
      </div>
    </div>

    <p v-show="!generations.length" class="muted">Генерацій немає. Зайди у групу і натисни <span class="msym sm">auto_awesome</span> «Генерувати» в учасника з оригінальним фото.</p>
  </section>

  <CropModal :subject="cropSubject" @close="cropGen = null" @applied="onCropped" />
  <RetouchModal :gen="retouchGen" @close="retouchGen = null" @saved="onRetouched" @restored="onRetouched" />
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { AdminModalKey } from '@/components/admin/adminModal'
import CropModal from '@/components/admin/CropModal.vue'
import RetouchModal from '@/components/admin/RetouchModal.vue'
import type { CropSubject, Generation, Group, Participant } from '@/types'

const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const modal = inject(AdminModalKey)!

const generations = ref<Generation[]>([])
const cropGen = ref<Generation | null>(null)
const retouchGen = ref<Generation | null>(null)
const groups = ref<Group[]>([])
const filterParticipants = ref<Participant[]>([])
const filterStatus = ref('')
const filterGroup = ref('')
const filterParticipant = ref('')
const genBust = ref(Date.now())

const hasError = computed(() => generations.value.some((g) => g.status === 'error'))

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

// Кроп-«subject» для відкритої генерації: повнорозмірний колаж → /crop генерації.
const cropSubject = computed<CropSubject | null>(() => {
  const g = cropGen.value
  if (!g) return null
  return {
    title: `Генерація #${g.id} — ${g.participant_name || '—'}`,
    meta: [g.group_name ? `група: ${g.group_name}` : '', `${g.model} · ${g.provider} · ${g.service_tier}`, g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : ''].filter(Boolean),
    imgSrc: `/api/generation-image/${g.id}?t=${g.id}`,
    endpoint: `/api/generations/${g.id}/crop`,
    applied: !!g.approved_at,
  }
})

// ── filters ──
async function loadGroups(): Promise<void> {
  groups.value = await call<Group[]>('GET', '/api/groups')
}
async function loadFilterParticipants(): Promise<void> {
  if (!filterGroup.value) {
    filterParticipants.value = []
    return
  }
  filterParticipants.value = await call<Participant[]>('GET', `/api/participants?group=${filterGroup.value}`)
}
async function onGroupFilter(): Promise<void> {
  filterParticipant.value = ''
  await loadFilterParticipants()
  await load()
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
  const q = new URLSearchParams()
  if (filterStatus.value) q.set('status', filterStatus.value)
  if (filterGroup.value) q.set('group', filterGroup.value)
  if (filterParticipant.value) q.set('participant_id', filterParticipant.value)
  const qs = q.toString()
  const list = await call<Generation[]>('GET', '/api/generations' + (qs ? `?${qs}` : ''))
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
  ui.toast(`Перегенерація #${r.id} — з оригінального фото учасника`, 'ok')
  startPoll()
  await load()
}
/** Сервер ріже колаж навпіл і пише аватарки. side: both|start|end. */
async function apply(g: Generation, side: 'both' | 'start' | 'end' = 'both'): Promise<void> {
  await call('POST', `/api/generations/${g.id}/approve`, { side })
  ui.toast(
    side === 'both'
      ? 'Застосовано: ліва половина → початок, права → кінець'
      : side === 'start'
        ? 'Застосовано лише початок (ліва половина)'
        : 'Застосовано лише кінець (права половина)',
    'ok'
  )
  await load()
}
// Кроп застосовано: оновлюємо список (бейдж «застосовано»), модалку НЕ закриваємо —
// типовий сценарій: вирізати початок, посунути рамку, вирізати кінець.
async function onCropped(): Promise<void> {
  await load()
}
// Ретуш збережено/відновлено: перечитуємо список і перевʼязуємо відкриту модалку
// на свіжий обʼєкт (бейджі «ретуш» і кнопка «Відновити оригінал» актуалізуються).
async function onRetouched(): Promise<void> {
  await load()
  if (retouchGen.value) {
    retouchGen.value = generations.value.find((g) => g.id === retouchGen.value!.id) ?? null
  }
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
/** Клік по згенерованому зображенню: готове → кроп-в'юер (виділити область і
 *  підтвердити «початок»/«кінець»); інакше — звичайна модалка (помилка/мета). */
function openResult(g: Generation): void {
  if (g.status === 'done' && g.has_image) cropGen.value = g
  else openGenModal(g)
}
function openGenModal(g: Generation): void {
  const meta = [
    g.group_name ? `група: ${g.group_name}` : '',
    g.participant_name ? `учасник: ${g.participant_name}` : '',
    `модель: ${g.model}`,
    `провайдер: ${g.provider}`,
    `тариф: ${g.service_tier}`,
    g.cost_usd != null ? `$${Number(g.cost_usd).toFixed(5)}` : '',
    g.approved_at ? 'застосовано до учасника' : '',
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
  if (g.status === 'error') {
    actions.push({
      label: 'Повторити',
      cls: '',
      onClick: async () => {
        await regen(g)
        modal.close()
      },
    })
  }

  modal.open({
    title: `Генерація #${g.id}`,
    imgSrc: g.has_image ? `/api/generation-image/${g.id}?t=${genBust.value}` : undefined,
    meta,
    actions,
  })
}

onMounted(async () => {
  // Підтримка діплінка /admin/generations?participant=N (з картки учасника).
  const qPid = String(route.query.participant ?? '')
  const qGroup = String(route.query.group ?? '')
  await loadGroups()
  if (qPid) {
    filterParticipant.value = qPid
    // Знайти групу учасника, щоб селект учасників мав опції.
    if (!qGroup) {
      for (const g of groups.value) {
        const ps = await call<Participant[]>('GET', `/api/participants?group=${g.id}`)
        if (ps.some((p) => String(p.id) === qPid)) {
          filterGroup.value = String(g.id)
          filterParticipants.value = ps
          break
        }
      }
    }
  }
  if (qGroup) {
    filterGroup.value = qGroup
    await loadFilterParticipants()
  }
  if (qPid || qGroup) void router.replace({ query: {} })
  await load()
  startPoll()
})
onBeforeUnmount(stopPoll)
</script>
