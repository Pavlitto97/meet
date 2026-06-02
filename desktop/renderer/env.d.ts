/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// Minimal preload bridge exposed by src/preload/index.ts (contextBridge 'meet').
interface Window {
  meet?: {
    versions: Record<string, string>
    onUpdate: (cb: (event: string, payload: unknown) => void) => void
  }
}
