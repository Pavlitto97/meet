/**
 * Preload — мінімальний міст. Renderer спілкується з бекендом через fetch('/api/...')
 * по протоколу app://, тож тут лише версії та керування авто-апдейтом (electron-updater
 * живе в main; рендер бачить лише валідовані IPC-канали, жодних токенів).
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { UpdateStatus } from '../main/updater';

contextBridge.exposeInMainWorld('meet', {
  versions: process.versions,
  updates: {
    /** Поточний статус апдейтера (для синхронізації UI при монтуванні). */
    getState: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:get-state'),
    /** Ручна перевірка оновлень (кнопка в Налаштуваннях). */
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke('update:check'),
    /** Перезапуск і встановлення завантаженого оновлення. true — якщо є що ставити. */
    install: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
    /** Підписка на пуш статусу з main. Повертає функцію відписки. */
    onStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
      const handler = (_e: unknown, status: UpdateStatus): void => cb(status);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },
});
