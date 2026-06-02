import type { InjectionKey } from 'vue'

// Shared large image modal (port of admin.js openImageModal/openGenModal/openShotModal).
// Tabs build a declarative config (title + image + meta chips + dynamic action buttons,
// each with a closure) and call open(); AdminView renders a single <ImageModal>.

export interface ModalAction {
  label: string
  cls?: string // '' | 'secondary' | 'reject'
  onClick: () => void
}

export interface ModalConfig {
  title: string
  imgSrc?: string
  meta?: string[]
  actions: ModalAction[]
}

export interface AdminModalApi {
  open(cfg: ModalConfig): void
  close(): void
}

export const AdminModalKey: InjectionKey<AdminModalApi> = Symbol('adminModal')
