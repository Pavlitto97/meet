import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface LaunchedApp {
  app: ElectronApplication;
  win: Page;
  userData: string;
}

/**
 * Піднімає ЗІБРАНИЙ застосунок (out/main/index.js — package.json "main") з
 * ІЗОЛЬОВАНИМ userData (тимчасова тека → свіжа БД, дев-дані не чіпаються).
 * ELECTRON_RUN_AS_NODE прибираємо: якщо воно лишиться в середовищі (деякі
 * sandbox/CI його виставляють), Electron-бінарник стартує як чистий Node —
 * без GUI/protocol — і Playwright не зможе підняти вікно.
 */
export async function launchApp(): Promise<LaunchedApp> {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') childEnv[k] = v;
  }
  childEnv.E2E = '1';
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'meet-e2e-'));
  childEnv.MEET_USERDATA = userData;
  const app = await electron.launch({ args: ['.'], env: childEnv });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win, userData };
}

export async function closeApp(launched: LaunchedApp | undefined): Promise<void> {
  if (!launched) return;
  await launched.app.close();
  fs.rmSync(launched.userData, { recursive: true, force: true });
}

/** Валідний PNG-портрет 320×400 для аплоадів у тестах (через sharp із залежностей). */
export async function testPngBuffer(): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({
    create: { width: 320, height: 400, channels: 3, background: { r: 196, g: 126, b: 92 } },
  })
    .png()
    .toBuffer();
}
