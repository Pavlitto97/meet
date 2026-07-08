/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// Preload bridge exposed by src/preload/index.ts (contextBridge 'meet').
// Дзеркало UpdateStatus із src/main/updater.ts (рендер — окремий TS-проєкт, тож
// тримаємо тут паралельну копію; зміни типу синхронізуй в обох місцях).
type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}

interface Window {
  meet?: {
    versions: Record<string, string>
    updates: {
      getState: () => Promise<UpdateStatus>
      check: () => Promise<UpdateStatus>
      install: () => Promise<boolean>
      onStatus: (cb: (status: UpdateStatus) => void) => () => void
    }
  }
}
