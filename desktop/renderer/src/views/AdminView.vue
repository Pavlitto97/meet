<template>
  <div class="admin-shell">
    <div class="admin-head">
      <h1><span class="msym">settings</span> Адмін-панель Meet</h1>
      <div class="links">
        <router-link to="/editor"><span class="msym">arrow_back</span> Редактор</router-link>
        <a href="#" title="Перегляд рендеру (початок)" @click.prevent="preview('start')"><span class="msym">play_arrow</span> Перегляд</a>
        <a href="#" title="Перегляд рендеру (кінець)" @click.prevent="preview('end')"><span class="msym">fast_forward</span> Кінець</a>
        <a href="#" title="Завантажити HTML (початок)" @click.prevent="download('start')"><span class="msym">download</span> HTML</a>
        <a href="#" title="Завантажити HTML (кінець)" @click.prevent="download('end')"><span class="msym">download</span> HTML кін</a>
        <router-link to="/degrade-lab"><span class="msym">blur_on</span> Лабораторія</router-link>
      </div>
    </div>

    <nav class="tabs">
      <router-link v-for="t in tabs" :key="t.to" :to="t.to" custom v-slot="{ navigate, isActive }">
        <button class="tab" :class="{ active: isActive }" @click="navigate">{{ t.label }}</button>
      </router-link>
    </nav>

    <router-view />
  </div>

  <ImageModal :config="modalConfig" @close="modalConfig = null" />
</template>

<script setup lang="ts">
import { ref, provide } from 'vue'
import ImageModal from '@/components/admin/ImageModal.vue'
import { AdminModalKey, type ModalConfig } from '@/components/admin/adminModal'

const tabs = [
  { to: '/admin/participants', label: 'Учасники' },
  { to: '/admin/generations', label: 'Генерації' },
  { to: '/admin/screenshots', label: 'Скріни' },
  { to: '/admin/settings', label: 'Налаштування' },
  { to: '/admin/prompt', label: 'Промт' },
]

// Shared image modal, provided to tab components.
const modalConfig = ref<ModalConfig | null>(null)
provide(AdminModalKey, {
  open: (cfg: ModalConfig) => { modalConfig.value = cfg },
  close: () => { modalConfig.value = null },
})

// Header render links (port: preview → named window.open; download → location.href).
function preview(which: 'start' | 'end'): void {
  window.open(`/api/render?which=${which}&t=${Date.now()}`, `meet-${which}`)
}
function download(which: 'start' | 'end'): void {
  window.location.href = `/api/render?which=${which}&download=1`
}
</script>
