import { useUiStore } from '@/stores/ui'

// Single fetch wrapper (port of old api()). The SPA is served from the app://meet
// origin, so root-relative '/api/...' resolves to app://meet/api/... and binary
// routes (avatars, render, screenshots) are loaded directly as <img>/<iframe> src.
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method }
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' }
    opts.body = JSON.stringify(body)
  }
  const r = await fetch(path, opts)
  const ct = r.headers.get('Content-Type') || ''
  const payload = ct.includes('json') ? await r.json() : await r.text()
  if (!r.ok) {
    const msg = payload && payload.error ? payload.error : `${method} ${path} → ${r.status}`
    throw new Error(msg)
  }
  return payload as T
}

// api() + toast-on-error + rethrow (port of admin.js call()). Used everywhere the
// old admin used call(); raw api() is used where errors are handled locally
// (e.g. the OpenRouter balance refresh).
export async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await api<T>(method, path, body)
  } catch (e: any) {
    useUiStore().toast(e.message, 'err')
    throw e
  }
}
