<template>
  <section class="panel active">
    <div class="card">
      <h3>Промт для генерації <span class="muted">(файл promt.md)</span></h3>
      <div class="prompt-box"><textarea v-model="promptText" spellcheck="false"></textarea></div>
      <div class="toolbar" style="margin-top:12px">
        <button @click="savePrompt">Зберегти промт</button>
        <input v-model="presetName" placeholder="назва пресета" style="background:var(--surface-2);color:var(--text);border:1px solid transparent;padding:8px 10px;border-radius:6px;font-family:inherit" />
        <button class="secondary" @click="savePreset"><span class="msym">save</span>Зберегти як пресет</button>
      </div>
    </div>
    <div class="card">
      <h3>Збережені пресети</h3>
      <table class="data">
        <thead><tr><th>Назва</th><th>Оновлено</th><th style="width:180px">Дії</th></tr></thead>
        <tbody>
          <tr v-for="p in presets" :key="p.id" :data-pid="p.id">
            <td>{{ p.name }}</td>
            <td class="muted">{{ p.updated_at || '' }}</td>
            <td>
              <div class="flex" style="gap:4px">
                <button class="iconbtn btn-sm" @click="loadPreset(p)"><span class="msym sm">download</span>Завантажити</button>
                <button class="iconbtn btn-sm danger" @click="delPreset(p)"><span class="msym sm">delete</span></button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-show="!presets.length" class="muted">Пресетів ще немає.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import type { Preset } from '@/types'

const ui = useUiStore()
const promptText = ref('')
const presetName = ref('')
const presets = ref<Preset[]>([])

async function load(): Promise<void> {
  const r = await call<{ prompt: string }>('GET', '/api/prompt')
  promptText.value = r.prompt || ''
  await loadPresets()
}
async function loadPresets(): Promise<void> {
  presets.value = await call<Preset[]>('GET', '/api/prompt/presets')
}
async function savePrompt(): Promise<void> {
  await call('PUT', '/api/prompt', { prompt: promptText.value })
  ui.toast('Промт збережено у promt.md', 'ok')
}
async function savePreset(): Promise<void> {
  const name = presetName.value.trim()
  if (!name) {
    ui.toast('Вкажи назву пресета', 'err')
    return
  }
  await call('POST', '/api/prompt/presets', { name, body: promptText.value })
  presetName.value = ''
  ui.toast('Пресет збережено', 'ok')
  await loadPresets()
}
function loadPreset(p: Preset): void {
  promptText.value = p.body
  ui.toast(`Завантажено «${p.name}» (не забудь «Зберегти промт»)`, 'ok')
}
async function delPreset(p: Preset): Promise<void> {
  await call('DELETE', `/api/prompt/presets/${p.id}`)
  ui.toast('Видалено', 'ok')
  await loadPresets()
}

onMounted(load)
</script>
