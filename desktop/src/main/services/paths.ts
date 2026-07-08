/**
 * Шляхи рантайму. Дані користувача — у app.getPath('userData') (переживає
 * авто-апдейти, per-user, writable). Meet-сторінка (index.html) + .bak —
 * read-only у ресурсах застосунку, читаються в памʼять у render.ts.
 */
import { app } from 'electron';
import path from 'node:path';

export function userDataDir(): string {
  return app.getPath('userData');
}

export function dbPath(): string {
  return path.join(userDataDir(), 'data.db');
}

export function promptFile(): string {
  return path.join(userDataDir(), 'promt.md');
}

/** Read-only ресурс (index.html / index.html.bak / promt.md seed). */
function resourcePath(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-resources', name)
    : path.join(app.getAppPath(), 'resources', name);
}

export function meetHtmlPath(): string {
  return resourcePath('index.html');
}

export function meetHtmlBakPath(): string {
  return resourcePath('index.html.bak');
}

export function promptSeedPath(): string {
  return resourcePath('promt.md');
}

/** Сплеш-прелоадер (splash.html — лише назва проекту, без зображень). */
export function splashHtmlPath(): string {
  return resourcePath('splash.html');
}

/** Білд Vue SPA (Vite outDir = renderer/dist). dev — desktop/renderer/dist; пакет — всередині asar. */
export function rendererDir(): string {
  return path.join(app.getAppPath(), 'renderer', 'dist');
}

/** Шлях до .env (креди). dev — desktop/.env; пакет — process.resourcesPath/.env. */
export function envPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.join(app.getAppPath(), '.env');
}
