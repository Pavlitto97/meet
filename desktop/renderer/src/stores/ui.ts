import { defineStore } from 'pinia'
import { ref } from 'vue'

// Global UI overlays mounted once in App.vue: a floating toast (port of makeToast,
// 2600ms) and in-app prompt/confirm dialogs (port of admin.js promptModal/confirmModal,
// which replace the native window.prompt/confirm — the latter is unsupported in Electron).

export interface PromptOpts {
  title?: string
  label?: string
  placeholder?: string
  value?: string
  okText?: string
}
export interface ConfirmOpts {
  title?: string
  message?: string
  okText?: string
  danger?: boolean
}

interface DialogState {
  kind: 'prompt' | 'confirm'
  title: string
  label: string
  message: string
  placeholder: string
  value: string
  okText: string
  danger: boolean
  resolve: (v: string | boolean | null) => void
}

export const useUiStore = defineStore('ui', () => {
  // ── toast ──
  const toastMsg = ref('')
  const toastCls = ref('')
  const toastShown = ref(false)
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  function toast(msg: string, cls = ''): void {
    toastMsg.value = msg
    toastCls.value = cls
    toastShown.value = true
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastShown.value = false }, 2600)
  }

  // ── prompt / confirm dialog ──
  const dialog = ref<DialogState | null>(null)

  function prompt(opts: PromptOpts = {}): Promise<string | null> {
    return new Promise((resolve) => {
      dialog.value = {
        kind: 'prompt',
        title: opts.title || '',
        label: opts.label || '',
        message: '',
        placeholder: opts.placeholder || '',
        value: opts.value || '',
        okText: opts.okText || 'OK',
        danger: false,
        resolve: resolve as (v: string | boolean | null) => void,
      }
    })
  }

  function confirm(opts: ConfirmOpts = {}): Promise<boolean> {
    return new Promise((resolve) => {
      dialog.value = {
        kind: 'confirm',
        title: opts.title || '',
        label: '',
        message: opts.message || '',
        placeholder: '',
        value: '',
        okText: opts.okText || 'OK',
        danger: !!opts.danger,
        resolve: resolve as (v: string | boolean | null) => void,
      }
    })
  }

  function resolveDialog(v: string | boolean | null): void {
    const d = dialog.value
    dialog.value = null
    d?.resolve(v)
  }

  return { toastMsg, toastCls, toastShown, toast, dialog, prompt, confirm, resolveDialog }
})
