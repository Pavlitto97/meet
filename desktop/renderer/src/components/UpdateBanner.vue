<template>
  <transition name="upd">
    <div v-if="visible" class="update-banner" :class="state">
      <span class="msym upd-ico">{{ icon }}</span>
      <div class="upd-body">
        <div class="upd-title">{{ title }}</div>
        <div v-if="state === 'downloading'" class="upd-bar"><i :style="{ width: percent + '%' }" /></div>
        <div v-else-if="sub" class="upd-sub">{{ sub }}</div>
      </div>
      <button v-if="state === 'downloaded'" class="btn-sm upd-go" @click="install">
        <span class="msym sm">restart_alt</span> Перезапустити й оновити
      </button>
      <button class="iconbtn btn-sm upd-x" title="Сховати" @click="dismissed = true"><span class="msym">close</span></button>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUpdatesStore } from '@/stores/updates'

// Глобальний банер апдейтера (монтується в App.vue). Показуємо лише дієві/важливі
// стани: завантаження, готово-до-встановлення, помилка. «checking/not-available/
// idle/disabled/available» — без банера (їх видно у вкладці «Налаштування»).
const updates = useUpdatesStore()
const dismissed = ref(false)

const state = computed<UpdateState>(() => updates.status?.state ?? 'idle')
const percent = computed(() => Math.round(updates.status?.percent ?? 0))
const version = computed(() => updates.status?.version ?? '')

const SHOWN: UpdateState[] = ['downloading', 'downloaded', 'error']
const visible = computed(() => SHOWN.includes(state.value) && !dismissed.value)

const icon = computed(() =>
  state.value === 'downloaded' ? 'system_update_alt' : state.value === 'error' ? 'error' : 'download',
)
const title = computed(() => {
  if (state.value === 'downloading') return `Завантаження оновлення${version.value ? ' ' + version.value : ''}…`
  if (state.value === 'downloaded') return `Оновлення ${version.value} готове`
  return 'Не вдалось перевірити оновлення'
})
const sub = computed(() => {
  if (state.value === 'error') return updates.status?.message ?? ''
  if (state.value === 'downloaded') return 'Перезапустіть, щоб застосувати.'
  return ''
})

// Новий стан → скидаємо ручне закриття попереднього (напр. downloading → downloaded
// має знову зʼявитись як «готово, перезапустити»).
watch(state, () => { dismissed.value = false })

function install(): void {
  void updates.install()
}
</script>
