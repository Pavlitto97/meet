import { defineStore } from 'pinia'
import { ref } from 'vue'

// Стан авто-апдейтера, віддзеркалений із main (src/main/updater.ts) через preload-міст
// window.meet.updates. Монтується ОДИН раз із App.vue (init): підписка на пуш статусу
// + початкова синхронізація через getState() (на випадок, якщо події вже минули до
// монтування рендера). UpdateBanner і вкладка «Налаштування» читають той самий стан.
// UpdateStatus — ambient-тип із env.d.ts (дзеркало main-типу).
export const useUpdatesStore = defineStore('updates', () => {
  const status = ref<UpdateStatus | null>(null)
  let unsub: (() => void) | null = null
  let started = false

  async function init(): Promise<void> {
    if (started) return
    started = true
    const u = window.meet?.updates
    if (!u) return // не Electron / без preload-моста — апдейтів нема
    unsub = u.onStatus((s) => { status.value = s })
    try {
      status.value = await u.getState()
    } catch {
      /* стан прийде окремо через onStatus */
    }
  }

  async function check(): Promise<void> {
    const u = window.meet?.updates
    if (!u) return
    try {
      status.value = await u.check()
    } catch {
      /* помилку покаже окремий пуш стану 'error' */
    }
  }

  async function install(): Promise<void> {
    await window.meet?.updates?.install()
  }

  function dispose(): void {
    unsub?.()
    unsub = null
    started = false
  }

  return { status, init, check, install, dispose }
})
