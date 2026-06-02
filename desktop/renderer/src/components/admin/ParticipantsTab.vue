<template>
  <section class="panel active">
    <div class="toolbar">
      <button @click="addParticipant"><span class="msym">add</span>Додати учасника</button>
      <button class="secondary" @click="load"><span class="msym">refresh</span>Оновити</button>
    </div>
    <table class="data">
      <thead>
        <tr>
          <th style="width:88px">№</th>
          <th>Аватарки</th>
          <th>Імʼя</th>
          <th style="width:70px">Пропуск</th>
          <th style="width:230px">Дії</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, idx) in participants" :key="p.device_id" :class="{ skipped: p.skipped }">
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
            <div class="flex" style="gap:6px">
              <img v-if="p.has_avatar" class="thumb" title="start" :src="thumbSrc(p.device_id, 'start')" />
              <span v-else class="thumb empty" title="немає"></span>
              <img v-if="p.has_avatar_end" class="thumb" title="end" :src="thumbSrc(p.device_id, 'end')" />
              <span v-else class="thumb empty" title="немає"></span>
            </div>
          </td>
          <td>
            <input class="i-name" :value="p.custom_name || ''" :placeholder="p.original_name || ''" @change="saveName(p.device_id, $event)" />
            <div v-if="p.user_added" style="margin-top:4px"><span class="badge user">вручну</span></div>
          </td>
          <td style="text-align:center">
            <input type="checkbox" class="i-skip" :checked="!!p.skipped" @change="saveSkip(p.device_id, $event)" />
          </td>
          <td>
            <div class="flex" style="gap:4px">
              <button class="iconbtn btn-sm" title="завантажити фото (початок)" @click="startUpload(p.device_id)"><span class="msym sm">upload</span></button>
              <button class="iconbtn btn-sm" :disabled="!!p.skipped" title="згенерувати AI-колаж" @click="generate(p.device_id)"><span class="msym sm">auto_awesome</span></button>
              <button class="iconbtn btn-sm" title="прибрати аватарки" @click="clearAvatars(p.device_id)"><span class="msym sm">close</span></button>
              <button v-if="p.user_added" class="iconbtn btn-sm danger" title="видалити" @click="del(p)"><span class="msym sm">delete</span></button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { call } from '@/lib/api'
import { fileToDataUrl } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import type { Participant } from '@/types'

const ui = useUiStore()
const ENC = encodeURIComponent
const participants = ref<Participant[]>([])
const bust = ref(Date.now())
const pendingUpload = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function thumbSrc(did: string, which: 'start' | 'end'): string {
  return `/api/avatar/${ENC(did)}?which=${which}&t=${bust.value}`
}

async function load(): Promise<void> {
  participants.value = await call<Participant[]>('GET', '/api/participants')
  bust.value = Date.now()
}

async function saveName(did: string, e: Event): Promise<void> {
  const v = (e.target as HTMLInputElement).value
  await call('PUT', `/api/participants/${ENC(did)}`, { custom_name: v || null })
  ui.toast('Збережено', 'ok')
}

async function saveSkip(did: string, e: Event): Promise<void> {
  const checked = (e.target as HTMLInputElement).checked
  await call('PUT', `/api/participants/${ENC(did)}`, { skipped: checked ? 1 : 0 })
  ui.toast('Збережено', 'ok')
  await load()
}

async function move(idx: number, dir: -1 | 1): Promise<void> {
  const order = participants.value.map((x) => x.device_id)
  const j = idx + dir
  if (j < 0 || j >= order.length) return
  ;[order[idx], order[j]] = [order[j], order[idx]]
  await call('POST', '/api/participants/reorder', { order })
  await load()
}

function startUpload(did: string): void {
  pendingUpload.value = did
  fileInput.value?.click()
}
async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !pendingUpload.value) return
  const dataUrl = await fileToDataUrl(file)
  await call('PUT', `/api/participants/${ENC(pendingUpload.value)}`, { avatar_data_url: dataUrl })
  ui.toast('Фото завантажено (початок)', 'ok')
  pendingUpload.value = null
  input.value = ''
  await load()
}

async function generate(did: string): Promise<void> {
  try {
    const r = await call<{ id: number }>('POST', '/api/generate', { participant_id: did })
    ui.toast(`Генерація #${r.id} стартувала — дивись вкладку «Генерації»`, 'ok')
  } catch {
    /* call() already toasted */
  }
}

async function clearAvatars(did: string): Promise<void> {
  await call('PUT', `/api/participants/${ENC(did)}`, { avatar_data_url: null, avatar_end_data_url: null })
  ui.toast('Аватарки прибрано', 'ok')
  await load()
}

async function del(p: Participant): Promise<void> {
  const ok = await ui.confirm({
    title: 'Видалити учасника?',
    message: `«${p.custom_name || p.original_name}» буде видалено назавжди.`,
    okText: 'Видалити',
    danger: true,
  })
  if (!ok) return
  await call('DELETE', `/api/participants/${ENC(p.device_id)}?hard=1`)
  ui.toast('Видалено', 'ok')
  await load()
}

async function addParticipant(): Promise<void> {
  const name = await ui.prompt({ title: 'Новий учасник', label: 'Імʼя учасника', placeholder: 'напр. Олег', okText: 'Додати' })
  if (!name || !name.trim()) return
  await call('POST', '/api/participants', { custom_name: name.trim() })
  ui.toast('Додано', 'ok')
  await load()
}

onMounted(load)
</script>
