<template>
  <section class="panel active">
    <div class="toolbar">
      <button @click="addGroup"><span class="msym">group_add</span>Створити групу</button>
      <button class="secondary" @click="load"><span class="msym">refresh</span>Оновити</button>
    </div>

    <p class="hint" style="margin:0 0 16px">
      Кожна група — окремий склад учасників зі своїми фото й генераціями.
      <b>Активна</b> група йде у перегляд зустрічі та скріни.
    </p>

    <div v-if="ready" class="group-grid">
      <div v-for="g in groups" :key="g.id" class="slot group-card" :class="{ 'is-active': g.active }" :data-gid="g.id" @click="open(g)">
        <div class="queue-head">
          <span class="msym group-ico">{{ g.active ? 'verified' : 'group' }}</span>
          <strong class="group-name">{{ g.name }}</strong>
          <span v-if="g.active" class="badge done">активна</span>
        </div>
        <div class="group-stats">
          <span title="учасників (без пропущених)"><span class="msym sm">person</span> {{ g.editable ?? 0 }}</span>
          <span title="з оригінальним фото"><span class="msym sm">image</span> {{ g.with_source ?? 0 }}</span>
          <span title="з аватаром початку/кінця"><span class="msym sm">portrait</span> {{ g.with_avatar ?? 0 }}/{{ g.with_avatar_end ?? 0 }}</span>
          <span title="генерацій"><span class="msym sm">auto_awesome</span> {{ g.generations }}</span>
        </div>
        <div class="row" @click.stop>
          <button class="gen-btn" @click="open(g)"><span class="msym sm">folder_open</span> Відкрити</button>
          <button v-if="!g.active" class="gen-btn" title="ця група піде у рендер і скріни" @click="activate(g)"><span class="msym sm">check_circle</span> Активувати</button>
          <button class="iconbtn btn-sm" title="перейменувати" @click="rename(g)"><span class="msym sm">edit</span></button>
          <button v-if="groups.length > 1" class="iconbtn btn-sm danger" title="видалити групу" @click="del(g)"><span class="msym sm">delete</span></button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import type { Group } from '@/types'

const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const groups = ref<Group[]>([])
// Список рендеримо лише коли вирішили НЕ перекидати на активну групу (інакше блимав
// би список перед редіректом).
const ready = ref(false)

async function load(): Promise<void> {
  groups.value = await call<Group[]>('GET', '/api/groups')
}

function open(g: Group): void {
  router.push(`/admin/groups/${g.id}`)
}

async function addGroup(): Promise<void> {
  const name = await ui.prompt({
    title: 'Нова група',
    label: 'Назва групи',
    placeholder: `напр. Група ${groups.value.length + 1}`,
    okText: 'Створити',
  })
  if (!name || !name.trim()) return
  const r = await call<{ id: number }>('POST', '/api/groups', { name: name.trim() })
  ui.toast('Групу створено', 'ok')
  router.push(`/admin/groups/${r.id}`)
}

async function rename(g: Group): Promise<void> {
  const name = await ui.prompt({ title: 'Перейменувати групу', label: 'Назва групи', value: g.name, okText: 'Зберегти' })
  if (!name || !name.trim() || name.trim() === g.name) return
  await call('PUT', `/api/groups/${g.id}`, { name: name.trim() })
  ui.toast('Перейменовано', 'ok')
  await load()
}

async function activate(g: Group): Promise<void> {
  await call('POST', `/api/groups/${g.id}/activate`)
  ui.toast(`«${g.name}» тепер активна — рендер і скріни беруть її учасників`, 'ok')
  await load()
}

async function del(g: Group): Promise<void> {
  const ok = await ui.confirm({
    title: 'Видалити групу?',
    message: `«${g.name}» разом з усіма учасниками та їх генераціями буде видалено назавжди.`,
    okText: 'Видалити',
    danger: true,
  })
  if (!ok) return
  await call('DELETE', `/api/groups/${g.id}`)
  ui.toast('Групу видалено', 'ok')
  await load()
}

// Вхід у вкладку «Групи» → автоматично відкриваємо детальну сторінку АКТИВНОЇ
// групи. Список усіх груп показуємо лише коли прийшли через кнопку «← Групи»
// (вона веде на ?list=1) — тоді редірект пропускаємо.
onMounted(async () => {
  const wantList = !!route.query.list // ?list=1 (через «← Групи») → показуємо список
  await load()
  // Якщо за час завантаження користувач уже пішов з /admin/groups (напр. клікнув
  // іншу вкладку) — НЕ редіректимо (інакше висмикнули б його назад).
  if (router.currentRoute.value.path !== '/admin/groups') {
    ready.value = true
    return
  }
  if (!wantList) {
    const active = groups.value.find((g) => g.active)
    if (active) {
      router.replace(`/admin/groups/${active.id}`)
      return
    }
  }
  ready.value = true
})

// Якщо вже на списку (?list=1) і користувач знову тиснe вкладку «Групи» (→ той самий
// маршрут без ?list, компонент НЕ перемонтовується) — теж перекидаємо на активну.
watch(
  () => route.query.list,
  (list) => {
    if (list || router.currentRoute.value.path !== '/admin/groups') return
    const active = groups.value.find((g) => g.active)
    if (active) router.replace(`/admin/groups/${active.id}`)
  }
)
</script>
