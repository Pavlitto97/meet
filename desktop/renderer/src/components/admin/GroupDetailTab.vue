<template>
  <section class="panel active">
    <div class="toolbar">
      <button class="secondary" @click="router.push('/admin/groups?list=1')"><span class="msym">arrow_back</span>Групи</button>
      <h2 class="group-title"><span class="msym">group</span> {{ group?.name || '…' }}</h2>
      <span v-if="group?.active" class="badge done">активна</span>
      <button v-else-if="group" class="btn-sm" title="ця група піде у рендер і скріни" @click="activate"><span class="msym sm">check_circle</span>Активувати</button>
      <span class="toolbar-right"></span>
      <button :disabled="!withSourceCount" :title="withSourceCount ? `генерація для ${withSourceCount} учасн. з оригіналом` : 'спершу завантаж оригінальні фото'" @click="generateAll">
        <span class="msym">auto_awesome</span>Згенерувати всім ({{ withSourceCount }})
      </button>
      <button @click="addParticipant"><span class="msym">person_add</span>Додати учасника</button>
      <button class="secondary" @click="load"><span class="msym">refresh</span>Оновити</button>
    </div>

    <p class="hint" style="margin:0 0 16px">
      <b>Оригінал</b> — фото, яке ти завантажуєш; саме з нього AI генерує кадри
      <b>початку</b> та <b>кінця</b> зустрічі. Перегенерація завжди йде з оригіналу.
    </p>

    <div class="card slide-card">
      <h3><span class="msym sm">co_present</span> Слайд презентації</h3>
      <div class="slide-row">
        <img v-if="group?.has_slide" class="slide-thumb" title="клік: збільшити" :src="slideSrc" @click="openSlide" />
        <span v-else class="slide-thumb empty" title="слайд не завантажено"><span class="msym">imagesmode</span></span>
        <div class="flex" style="gap:8px">
          <button @click="startUpload(0, 'slide')"><span class="msym sm">upload</span>{{ group?.has_slide ? 'Замінити слайд' : 'Завантажити слайд' }}</button>
          <button v-if="group?.has_slide" class="iconbtn btn-sm danger" title="прибрати слайд" @click="clearSlide"><span class="msym sm">delete</span></button>
        </div>
        <p class="hint" style="margin:0">
          Зображення з ПК, яке вставляється в область презентації рендеру цієї групи
          (початок і кінець). Без слайда лишається презентація з шаблону.
          Якщо завантажити скріншот усього міта — слайд автоматично обріжеться до
          області презентації (щоб у рендері не було «міта в міті» з другою панеллю «Люди»).
        </p>
      </div>
    </div>

    <table class="data">
      <thead>
        <tr>
          <th style="width:88px">№</th>
          <th style="width:120px">Оригінал</th>
          <th style="width:170px">Початок / Кінець</th>
          <th>Імʼя</th>
          <th style="width:70px">Пропуск</th>
          <th style="width:250px">Дії</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, idx) in participants" :key="p.id" :class="{ skipped: p.skipped }">
          <td>
            <div class="num-cell">
              <span class="rownum mono">{{ idx + 1 }}</span>
              <div class="reorder">
                <button class="iconbtn btn-sm" title="вище" :disabled="idx === 0" @click="move(idx, -1)"><span class="msym sm">arrow_upward</span></button>
                <button class="iconbtn btn-sm" title="нижче" :disabled="idx >= participants.length - 1" @click="move(idx, 1)"><span class="msym sm">arrow_downward</span></button>
              </div>
            </div>
          </td>
          <td>
            <div class="thumb-stack">
              <img v-if="p.has_source" class="thumb tall" title="оригінал — клік: збільшити" :src="thumbSrc(p.id, 'source')" @click="openImage(p, 'source')" />
              <button v-else class="thumb tall empty as-btn" title="завантажити оригінальне фото" @click="startUpload(p.id, 'source')"><span class="msym">add_photo_alternate</span></button>
              <button class="iconbtn btn-sm" title="завантажити/замінити оригінал" @click="startUpload(p.id, 'source')"><span class="msym sm">upload</span></button>
            </div>
          </td>
          <td>
            <div class="flex" style="gap:6px">
              <img v-if="p.has_avatar" class="thumb" title="початок зустрічі — клік: збільшити" :src="thumbSrc(p.id, 'start')" @click="openImage(p, 'start')" />
              <span v-else class="thumb empty" title="початок: немає"></span>
              <img v-if="p.has_avatar_end" class="thumb" title="кінець зустрічі — клік: збільшити" :src="thumbSrc(p.id, 'end')" @click="openImage(p, 'end')" />
              <span v-else class="thumb empty" title="кінець: немає"></span>
            </div>
          </td>
          <td>
            <input class="i-name" :value="p.custom_name || ''" :placeholder="p.original_name || ''" @change="saveName(p.id, $event)" />
            <div v-if="p.user_added" style="margin-top:4px"><span class="badge user">вручну</span></div>
          </td>
          <td style="text-align:center">
            <input type="checkbox" class="i-skip" :checked="!!p.skipped" @change="saveSkip(p.id, $event)" />
          </td>
          <td>
            <div class="flex" style="gap:4px">
              <button class="gen-btn" :disabled="!!p.skipped || !p.has_source" :title="p.has_source ? 'згенерувати кадри початку/кінця з оригіналу' : 'спершу завантаж оригінал'" @click="generate(p)">
                <span class="msym sm">auto_awesome</span> Генерувати
              </button>
              <button class="gen-btn" title="історія генерацій цього учасника" @click="router.push(`/admin/generations?participant=${p.id}`)">
                <span class="msym sm">history</span>
              </button>
              <button class="iconbtn btn-sm" title="прибрати фото (оригінал + аватарки)" @click="clearImages(p)"><span class="msym sm">close</span></button>
              <button class="iconbtn btn-sm danger" :title="p.user_added ? 'видалити назавжди' : 'видалити (можна відновити)'" @click="del(p)"><span class="msym sm">delete</span></button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="deletedParticipants.length" class="deleted-block">
      <h3><span class="msym sm">delete_history</span> Видалені учасники <span class="muted">({{ deletedParticipants.length }})</span></h3>
      <p class="hint" style="margin:4px 0 8px">У рендері їхні плитки показуються як у вихідному шаблоні (рідна буква й колір), правки скинуто.</p>
      <div v-for="p in deletedParticipants" :key="p.id" class="deleted-row">
        <span class="del-name">{{ p.original_name }}</span>
        <button class="btn-sm" title="повернути учасника в список" @click="restore(p)"><span class="msym sm">restore_from_trash</span>Відновити</button>
      </div>
    </div>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
  </section>

  <CropModal :subject="cropSubject" @close="cropSubject = null" @applied="onCropApplied" />
</template>

<script setup lang="ts">
import { ref, computed, inject, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { call } from '@/lib/api'
import { fileToDataUrl } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import { AdminModalKey } from '@/components/admin/adminModal'
import CropModal from '@/components/admin/CropModal.vue'
import type { CropSubject, Generation, Group, Participant } from '@/types'

const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const modal = inject(AdminModalKey)!

const group = ref<Group | null>(null)
const participants = ref<Participant[]>([])
const deletedParticipants = ref<Participant[]>([])
const bust = ref(Date.now())
const pendingUpload = ref<{ id: number; kind: 'source' | 'start' | 'slide' } | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const cropSubject = ref<CropSubject | null>(null)

const groupId = computed(() => parseInt(String(route.params.id), 10))
const withSourceCount = computed(() => participants.value.filter((p) => p.has_source && !p.skipped).length)
const slideSrc = computed(() => `/api/groups/${groupId.value}/slide?t=${bust.value}`)

function thumbSrc(id: number, which: 'start' | 'end' | 'source'): string {
  return `/api/avatar/${id}?which=${which}&t=${bust.value}`
}

async function load(): Promise<void> {
  const [groupsList, list, deletedList] = await Promise.all([
    call<Group[]>('GET', '/api/groups'),
    call<Participant[]>('GET', `/api/participants?group=${groupId.value}`),
    call<Participant[]>('GET', `/api/participants?group=${groupId.value}&deleted=1`),
  ])
  group.value = groupsList.find((g) => g.id === groupId.value) ?? null
  if (!group.value) {
    router.replace('/admin/groups')
    return
  }
  participants.value = list
  deletedParticipants.value = deletedList
  bust.value = Date.now()
}

async function activate(): Promise<void> {
  await call('POST', `/api/groups/${groupId.value}/activate`)
  ui.toast('Група тепер активна — рендер і скріни беруть її учасників', 'ok')
  await load()
}

async function saveName(id: number, e: Event): Promise<void> {
  const v = (e.target as HTMLInputElement).value
  await call('PUT', `/api/participants/${id}`, { custom_name: v || null })
  ui.toast('Збережено', 'ok')
}

async function saveSkip(id: number, e: Event): Promise<void> {
  const checked = (e.target as HTMLInputElement).checked
  await call('PUT', `/api/participants/${id}`, { skipped: checked ? 1 : 0 })
  ui.toast('Збережено', 'ok')
  await load()
}

async function move(idx: number, dir: -1 | 1): Promise<void> {
  const order = participants.value.map((x) => x.id)
  const j = idx + dir
  if (j < 0 || j >= order.length) return
  ;[order[idx], order[j]] = [order[j], order[idx]]
  await call('POST', '/api/participants/reorder', { group_id: groupId.value, order })
  await load()
}

function startUpload(id: number, kind: 'source' | 'start' | 'slide'): void {
  pendingUpload.value = { id, kind }
  fileInput.value?.click()
}
async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  const pending = pendingUpload.value
  if (!file || !pending) return
  // finally: інакше після помилки (битий файл/відмова сервера) повторний вибір
  // ТОГО САМОГО файлу не дає change-події — тихий no-op.
  try {
    const dataUrl = await fileToDataUrl(file)
    if (pending.kind === 'slide') {
      const r = await call<{ cropped?: number }>('PUT', `/api/groups/${groupId.value}/slide`, { slide_data_url: dataUrl })
      ui.toast(
        r.cropped
          ? 'Схоже на скріншот усього міта — слайд автоматично обрізано до області презентації'
          : 'Слайд завантажено — він вставиться в область презентації рендеру',
        'ok'
      )
    } else {
      const body = pending.kind === 'source' ? { source_data_url: dataUrl } : { avatar_data_url: dataUrl }
      await call('PUT', `/api/participants/${pending.id}`, body)
      ui.toast(pending.kind === 'source' ? 'Оригінал завантажено — тепер можна генерувати' : 'Фото завантажено (початок)', 'ok')
    }
  } finally {
    pendingUpload.value = null
    input.value = ''
  }
  await load()
}

async function clearSlide(): Promise<void> {
  const ok = await ui.confirm({
    title: 'Прибрати слайд?',
    message: 'Область презентації в рендері повернеться до вигляду з шаблону.',
    okText: 'Прибрати',
    danger: true,
  })
  if (!ok) return
  await call('DELETE', `/api/groups/${groupId.value}/slide`)
  ui.toast('Слайд прибрано', 'ok')
  await load()
}

function openSlide(): void {
  modal.open({
    title: `${group.value?.name ?? ''} — слайд презентації`,
    imgSrc: slideSrc.value,
    actions: [{ label: 'Закрити', cls: 'secondary', onClick: () => modal.close() }],
  })
}

async function generate(p: Participant): Promise<void> {
  try {
    const r = await call<{ id: number }>('POST', '/api/generate', { participant_id: p.id })
    ui.toast(`Генерація #${r.id} стартувала — дивись вкладку «Генерації»`, 'ok')
  } catch {
    /* call() already toasted */
  }
}

async function generateAll(): Promise<void> {
  const targets = participants.value.filter((p) => p.has_source && !p.skipped)
  if (!targets.length) return
  const ok = await ui.confirm({
    title: 'Згенерувати всім?',
    message: `Стартує ${targets.length} AI-генерацій (по одній на учасника з оригіналом). Кожна коштує грошей.`,
    okText: 'Генерувати',
  })
  if (!ok) return
  let started = 0
  for (const p of targets) {
    try {
      await call<{ id: number }>('POST', '/api/generate', { participant_id: p.id })
      started++
    } catch {
      /* call() already toasted */
    }
  }
  ui.toast(`Стартувало генерацій: ${started} — дивись вкладку «Генерації»`, 'ok')
}

async function clearImages(p: Participant): Promise<void> {
  const ok = await ui.confirm({
    title: 'Прибрати фото?',
    message: `У «${p.custom_name || p.original_name}» буде прибрано оригінал і аватарки початку/кінця.`,
    okText: 'Прибрати',
    danger: true,
  })
  if (!ok) return
  await call('PUT', `/api/participants/${p.id}`, { source_data_url: null, avatar_data_url: null, avatar_end_data_url: null })
  ui.toast('Фото прибрано', 'ok')
  await load()
}

async function del(p: Participant): Promise<void> {
  const ok = await ui.confirm({
    title: 'Видалити учасника?',
    message: p.user_added
      ? `«${p.custom_name || p.original_name}» буде видалено назавжди разом з генераціями.`
      : `«${p.custom_name || p.original_name}» зникне зі списку разом з фото і генераціями; плитка в рендері повернеться до вигляду шаблону. Учасника можна буде відновити.`,
    okText: 'Видалити',
    danger: true,
  })
  if (!ok) return
  await call('DELETE', `/api/participants/${p.id}`)
  ui.toast('Видалено', 'ok')
  await load()
}

async function restore(p: Participant): Promise<void> {
  await call('POST', `/api/participants/${p.id}/restore`)
  ui.toast(`«${p.original_name}» відновлено`, 'ok')
  await load()
}

async function addParticipant(): Promise<void> {
  const name = await ui.prompt({ title: 'Новий учасник', label: 'Імʼя учасника', placeholder: 'напр. Олег', okText: 'Додати' })
  if (!name || !name.trim()) return
  await call('POST', '/api/participants', { group_id: groupId.value, custom_name: name.trim() })
  ui.toast('Додано', 'ok')
  await load()
}

const WHICH_LABEL: Record<string, string> = { source: 'оригінал', start: 'початок зустрічі', end: 'кінець зустрічі' }
function openImage(p: Participant, which: 'source' | 'start' | 'end'): void {
  const actions: Array<{ label: string; cls: string; onClick: () => void }> = [
    { label: 'Закрити', cls: 'secondary', onClick: () => modal.close() },
  ]
  // Для аватарок початку/кінця даємо переобрізати їх (з генерації, якщо є).
  if (which === 'start' || which === 'end') {
    actions.unshift({ label: 'Кроп', cls: '', onClick: () => void openCropFor(p, which) })
  }
  modal.open({ title: `${p.custom_name || p.original_name} — ${WHICH_LABEL[which]}`, imgSrc: thumbSrc(p.id, which), actions })
}

/**
 * Відкрити кроп для аватарки учасника. Гібрид: якщо для учасника є готова
 * генерація — ріжемо ПОВНОРОЗМІРНИЙ колаж (макс. якість, наявний /crop генерації,
 * перевага застосованій); інакше (аватарку завантажено вручну) — ріжемо саме цю
 * зменшену аватарку через /api/participants/<id>/crop. У будь-якому разі CropModal
 * дає призначити вирізане у Початок або Кінець.
 */
async function openCropFor(p: Participant, which: 'start' | 'end'): Promise<void> {
  modal.close()
  let gens: Generation[] = []
  try {
    gens = await call<Generation[]>('GET', `/api/generations?participant_id=${p.id}`)
  } catch {
    /* call() вже показав тост — впадемо у фолбек на аватарку */
  }
  const done = gens.filter((g) => g.status === 'done' && g.has_image)
  const gen = done.find((g) => g.approved_at) ?? done[0] // застосована, інакше найновіша готова
  const bust = Date.now()
  const name = p.custom_name || p.original_name
  cropSubject.value = gen
    ? {
        title: `${name} — кроп з генерації #${gen.id}`,
        meta: ['повнорозмірний колаж — виділи область і признач у початок/кінець'],
        imgSrc: `/api/generation-image/${gen.id}?t=${bust}`,
        endpoint: `/api/generations/${gen.id}/crop`,
        applied: !!gen.approved_at,
      }
    : {
        title: `${name} — кроп аватарки (${WHICH_LABEL[which]})`,
        meta: ['генерації немає — ріжемо поточну (зменшену) аватарку'],
        imgSrc: `/api/avatar/${p.id}?which=${which}&t=${bust}`,
        endpoint: `/api/participants/${p.id}/crop`,
        from: which,
      }
}

// Кроп застосовано: оновлюємо мініатюри (bust змінюється у load). Модалку НЕ
// закриваємо — типовий сценарій: вирізати початок, посунути рамку, вирізати кінець.
async function onCropApplied(): Promise<void> {
  await load()
}

watch(groupId, (v) => {
  if (Number.isFinite(v)) void load()
})
onMounted(load)
</script>
