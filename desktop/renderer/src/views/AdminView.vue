<template>
  <div class="admin-shell">
    <div class="admin-head">
      <h1><span class="msym">videocam</span> Meet Editor</h1>
      <div class="links">
        <span class="links-label">Перегляд зустрічі:</span>
        <a href="#" title="Відкрити рендер початку зустрічі" @click.prevent="preview('start')"><span class="msym">line_start_circle</span> Початок зустрічі</a>
        <a href="#" title="Відкрити рендер кінця зустрічі" @click.prevent="preview('end')"><span class="msym">line_end_circle</span> Кінець зустрічі</a>
      </div>
    </div>

    <nav class="tabs">
      <button v-for="t in tabs" :key="t.to" class="tab" :class="{ active: route.meta.tab === t.tab }" @click="router.push(t.to)">
        {{ t.label }}
      </button>
    </nav>

    <router-view />
  </div>

  <ImageModal :config="modalConfig" @close="modalConfig = null" />
</template>

<script setup lang="ts">
import { ref, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ImageModal from '@/components/admin/ImageModal.vue'
import { AdminModalKey, type ModalConfig } from '@/components/admin/adminModal'

const route = useRoute()
const router = useRouter()

// Активність табу — за meta.tab (так «Групи» лишається активним і в /admin/groups/5).
const tabs = [
  { to: '/admin/groups', tab: 'groups', label: 'Групи' },
  { to: '/admin/generations', tab: 'generations', label: 'Генерації' },
  { to: '/admin/screenshots', tab: 'screenshots', label: 'Скріни' },
  { to: '/admin/settings', tab: 'settings', label: 'Налаштування' },
  { to: '/admin/prompt', tab: 'prompt', label: 'Промт' },
]

// Shared image modal, provided to tab components.
const modalConfig = ref<ModalConfig | null>(null)
provide(AdminModalKey, {
  open: (cfg: ModalConfig) => { modalConfig.value = cfg },
  close: () => { modalConfig.value = null },
})

// Прев'ю рендеру: початок або кінець зустрічі, у новому вікні. На сторінці
// конкретної групи показуємо САМЕ її (?group=), інакше — активну групу.
function preview(which: 'start' | 'end'): void {
  const gid = route.meta.tab === 'groups' && route.params.id ? `&group=${route.params.id}` : ''
  window.open(`/api/render?which=${which}${gid}&t=${Date.now()}`, `meet-${which}`)
}
</script>
