/**
 * Preload — мінімальний міст. Renderer спілкується з бекендом через fetch('/api/...')
 * по протоколу app://, тож тут лише версії та підписка на події апдейтера.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('meet', {
  versions: process.versions,
  onUpdate: (cb: (event: string, payload: unknown) => void) => {
    for (const ch of ['update:available', 'update:progress', 'update:downloaded']) {
      ipcRenderer.on(ch, (_e, payload) => cb(ch, payload));
    }
  },
});
