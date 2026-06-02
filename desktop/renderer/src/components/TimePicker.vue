<template>
  <input ref="el" :placeholder="placeholder" readonly />
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import flatpickr from 'flatpickr'
import { parseTime } from '@/lib/util'

// 12-hour time picker (port of wireTimePicker). Initialized ONCE on mount with the
// composed display string; emits {time, period} on change. The parent autosaves.
const props = defineProps<{ display: string; placeholder?: string }>()
const emit = defineEmits<{ (e: 'change', payload: { time: string; period: string }): void }>()

const el = ref<HTMLInputElement | null>(null)
let fp: any = null

onMounted(() => {
  if (!el.value) return
  el.value.value = props.display
  fp = flatpickr(el.value, {
    enableTime: true,
    noCalendar: true,
    dateFormat: 'h:i K',
    time_24hr: false,
    defaultDate: props.display,
    allowInput: false,
    onChange: (_sel: Date[], str: string) => {
      const p = parseTime(str)
      if (p) emit('change', p)
    },
  })
})

onBeforeUnmount(() => {
  fp?.destroy()
  fp = null
})
</script>
