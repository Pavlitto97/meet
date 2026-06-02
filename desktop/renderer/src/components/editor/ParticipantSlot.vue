<template>
  <div class="slot" :class="{ skipped: p.skipped, busy: isBusy }" :data-id="p.device_id">
    <span v-if="p.skipped" class="skip-tag">пропускаємо</span>
    <span v-if="p.user_added" class="user-tag">додано вручну</span>

    <div class="field">
      <label>Ім'я</label>
      <input
        v-model="name"
        class="name-input"
        type="text"
        :placeholder="p.original_name || ''"
        :disabled="!!p.skipped"
        @change="saveName"
      />
    </div>

    <div class="avatar-pair">
      <div class="avatar-side">
        <div class="avatar-label">початок</div>
        <div class="preview preview-start">
          <img v-if="hasAvatar" :src="avatarSrc('start')" />
        </div>
      </div>
      <div class="avatar-side">
        <div class="avatar-label">кінець {{ hasAvatarEnd ? '' : '(=початок)' }}</div>
        <div class="preview preview-end">
          <img v-if="hasAvatarEnd" :src="avatarSrc('end')" />
          <img v-else-if="hasAvatar" :src="avatarSrc('start')" style="opacity: 0.4" />
        </div>
      </div>
    </div>

    <div class="row">
      <label class="file-btn">
        {{ hasAvatar ? 'Замінити початок' : 'Завантажити фото' }}
        <input ref="fileInput" type="file" accept="image/*" :disabled="!!p.skipped" @change="onFile" />
      </label>
      <button
        v-show="hasAvatar || hasAvatarEnd"
        type="button"
        class="clear-btn"
        title="Прибрати обидва фото"
        @click="clearAvatars"
      >×</button>
    </div>

    <div class="row">
      <button
        type="button"
        class="gen-btn"
        :disabled="genDisabled"
        title="Згенерувати колаж і розділити на початок/кінець"
        @click="generate"
      >✨ Згенерувати</button>
      <button
        v-if="p.user_added"
        type="button"
        class="del-btn"
        title="Видалити учасника"
        @click="del"
      >🗑</button>
    </div>

    <div class="gen-status" :class="{ err: genStatusErr }">
      <template v-if="genState.kind === 'pending'">
        <span>Зображення в обробці… #{{ genState.id }}</span>
        <div class="loader-bar"></div>
      </template>
      <template v-else-if="genState.kind === 'error'">Помилка: {{ genState.error || 'невідома' }}</template>
      <template v-else-if="localMsg">{{ localMsg }}</template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { api } from '@/lib/api'
import { fileToDataUrl } from '@/lib/util'
import { useUiStore } from '@/stores/ui'
import type { Participant } from '@/types'

export interface GenState {
  kind: 'pending' | 'error' | 'idle'
  id?: number
  error?: string | null
}

const props = defineProps<{ participant: Participant; genState: GenState }>()
const emit = defineEmits<{
  (e: 'status', msg: string, cls: string): void
  (e: 'generate'): void
  (e: 'deleted', deviceId: string): void
}>()

const ui = useUiStore()
const p = computed(() => props.participant)
const enc = computed(() => encodeURIComponent(props.participant.device_id))

const name = ref(props.participant.custom_name || '')
const hasAvatar = ref(props.participant.has_avatar === 1)
const hasAvatarEnd = ref(props.participant.has_avatar_end === 1)
const bust = ref(Date.now())
const fileInput = ref<HTMLInputElement | null>(null)

// Transient local gen message ("Стартую…" / "Генерація #N…" / a generate error),
// shown until the 2s poll's genState takes over.
const localMsg = ref('')
const localErr = ref(false)
const localBusy = ref(false)

const genStatusErr = computed(() => props.genState.kind === 'error' || (!!localMsg.value && localErr.value))
const isBusy = computed(() => props.genState.kind === 'pending' || localBusy.value)
const genDisabled = computed(() => !!props.participant.skipped || props.genState.kind === 'pending' || localBusy.value)

// Re-sync local state when the parent reloads participants (loadParticipants() hands a
// fresh object for the same :key, reusing this instance so setup() does NOT re-run).
// The original rebuilt the whole DOM each reload; this mirrors that. Bumping bust forces
// the <img> to refetch (e.g. a new avatar approved over an old one).
watch(
  () => props.participant,
  (np) => {
    name.value = np.custom_name || ''
    hasAvatar.value = np.has_avatar === 1
    hasAvatarEnd.value = np.has_avatar_end === 1
    bust.value = Date.now()
  },
)

// Every poll rebuilds genState (fresh object), so this fires once the server-derived
// status is known — drop the transient local message/busy flag and let genState drive
// the UI (pending/error shown from genState; idle → cleared, like the original poll did).
watch(
  () => props.genState,
  () => {
    localMsg.value = ''
    localErr.value = false
    localBusy.value = false
  },
)

function avatarSrc(which: 'start' | 'end'): string {
  return `/api/avatar/${enc.value}?which=${which}&t=${bust.value}`
}

async function saveName(): Promise<void> {
  try {
    await api('PUT', `/api/participants/${enc.value}`, { custom_name: name.value || null })
    emit('status', 'Збережено', 'ok')
  } catch (e: any) {
    emit('status', e.message, 'err')
  }
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const dataUrl = await fileToDataUrl(file)
  try {
    await api('PUT', `/api/participants/${enc.value}`, { avatar_data_url: dataUrl })
    hasAvatar.value = true
    bust.value = Date.now()
    emit('status', 'Збережено', 'ok')
  } catch (e2: any) {
    emit('status', e2.message, 'err')
  }
  input.value = ''
}

async function clearAvatars(): Promise<void> {
  try {
    await api('PUT', `/api/participants/${enc.value}`, { avatar_data_url: null, avatar_end_data_url: null })
    hasAvatar.value = false
    hasAvatarEnd.value = false
    emit('status', 'Прибрано', 'ok')
  } catch (e: any) {
    emit('status', e.message, 'err')
  }
}

async function generate(): Promise<void> {
  if (genDisabled.value) return
  localBusy.value = true
  localErr.value = false
  localMsg.value = 'Стартую…'
  try {
    const r = await api<{ id: number }>('POST', '/api/generate', { participant_id: props.participant.device_id })
    localMsg.value = `Генерація #${r.id}…`
    emit('generate')
  } catch (e: any) {
    localMsg.value = e.message
    localErr.value = true
    localBusy.value = false
  }
}

async function del(): Promise<void> {
  const ok = await ui.confirm({
    title: 'Видалити учасника?',
    message: `«${name.value || props.participant.original_name}» буде видалено назавжди.`,
    okText: 'Видалити',
    danger: true,
  })
  if (!ok) return
  try {
    await api('DELETE', `/api/participants/${enc.value}?hard=1`)
    emit('status', 'Видалено', 'ok')
    emit('deleted', props.participant.device_id)
  } catch (e: any) {
    emit('status', e.message, 'err')
  }
}
</script>
