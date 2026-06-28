<template>
  <div class="modal-bg" :class="{ show: !!config }" @click.self="emit('close')">
    <div class="modal modal-img">
      <h3>{{ config?.title }}</h3>
      <div class="gen-preview" :class="{ zoomable: !!config?.imgSrc }" :title="config?.imgSrc ? 'Натисни, щоб відкрити на весь екран' : ''" @click="config?.imgSrc && (fullscreen = true)">
        <img v-if="config?.imgSrc" :src="config.imgSrc" />
      </div>
      <div class="gen-meta">
        <span v-for="(m, i) in config?.meta || []" :key="i">{{ m }}</span>
      </div>
      <div class="modal-actions">
        <button v-for="(a, i) in config?.actions || []" :key="i" :class="a.cls" @click="a.onClick">{{ a.label }}</button>
      </div>
    </div>
  </div>

  <!-- Повноекранний перегляд зображення: клік будь-де або Esc — закрити. -->
  <div v-if="fullscreen && config?.imgSrc" class="img-fs" @click="fullscreen = false">
    <img :src="config.imgSrc" @click.stop="fullscreen = false" />
    <button class="img-fs-close" title="Закрити (Esc)" @click.stop="fullscreen = false"><span class="msym">close</span></button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import type { ModalConfig } from './adminModal'

const props = defineProps<{ config: ModalConfig | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const fullscreen = ref(false)

// Esc: спершу закриває повноекранний перегляд, інакше — сам модал.
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (fullscreen.value) {
    fullscreen.value = false
    return
  }
  if (props.config) emit('close')
}

// Слухач клавіш живе лише поки модал відкритий.
watch(
  () => props.config,
  (c) => {
    if (c) {
      document.addEventListener('keydown', onKey, true)
    } else {
      document.removeEventListener('keydown', onKey, true)
      fullscreen.value = false
    }
  }
)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
</script>
