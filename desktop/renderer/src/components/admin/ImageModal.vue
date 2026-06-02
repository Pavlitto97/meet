<template>
  <div class="modal-bg" :class="{ show: !!config }" @click.self="emit('close')">
    <div class="modal">
      <h3>{{ config?.title }}</h3>
      <div class="gen-preview">
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
</template>

<script setup lang="ts">
import type { ModalConfig } from './adminModal'

defineProps<{ config: ModalConfig | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>
