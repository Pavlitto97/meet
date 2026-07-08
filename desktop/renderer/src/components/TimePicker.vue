<template>
  <input ref="el" :placeholder="placeholder" readonly />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import flatpickr from 'flatpickr'
import { parseTime24 } from '@/lib/util'

// 24-год пікер часу (як в Україні, без AM/PM). Ініціалізується ОДИН раз на mount
// зі стартовим значенням; на зміну емітить {time: "HH:MM"}. Автозбереження — у батька.
const props = defineProps<{ display: string; placeholder?: string }>()
const emit = defineEmits<{ (e: 'change', payload: { time: string }): void }>()

const el = ref<HTMLInputElement | null>(null)
let fp: any = null

onMounted(() => {
  if (!el.value) return
  el.value.value = props.display
  fp = flatpickr(el.value, {
    enableTime: true,
    noCalendar: true,
    dateFormat: 'H:i',
    time_24hr: true,
    defaultDate: props.display,
    allowInput: false,
    onChange: (_sel: Date[], str: string) => {
      const t = parseTime24(str)
      if (t) emit('change', { time: t })
    },
  })
})

onBeforeUnmount(() => {
  fp?.destroy()
  fp = null
})
</script>
