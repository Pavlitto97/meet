<template>
  <div v-if="d" class="modal-bg show" @mousedown.self="cancel">
    <div class="modal modal-sm" role="dialog" aria-modal="true">
      <h3>{{ d.title }}</h3>
      <template v-if="d.kind === 'prompt'">
        <label v-if="d.label" class="modal-label">{{ d.label }}</label>
        <input ref="inputEl" v-model="inputVal" class="modal-input" type="text" :placeholder="d.placeholder" />
      </template>
      <p v-else-if="d.message" class="modal-msg">{{ d.message }}</p>
      <div class="modal-actions">
        <button class="secondary" @click="cancel">Скасувати</button>
        <button ref="okEl" :class="{ reject: d.danger }" @click="ok">{{ d.okText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const d = computed(() => ui.dialog)
const inputVal = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const okEl = ref<HTMLButtonElement | null>(null)

watch(d, async (val) => {
  if (!val) return
  inputVal.value = val.value || ''
  await nextTick()
  if (val.kind === 'prompt') {
    inputEl.value?.focus()
    inputEl.value?.select()
  } else {
    okEl.value?.focus()
  }
})

function cancel(): void {
  ui.resolveDialog(d.value?.kind === 'prompt' ? null : false)
}
function ok(): void {
  ui.resolveDialog(d.value?.kind === 'prompt' ? inputVal.value : true)
}
function onKey(e: KeyboardEvent): void {
  if (!d.value) return
  if (e.key === 'Escape') {
    e.preventDefault()
    cancel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    ok()
  }
}
onMounted(() => document.addEventListener('keydown', onKey, true))
onUnmounted(() => document.removeEventListener('keydown', onKey, true))
</script>
