import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Renderer (Vue 3 SPA) build. Root is passed positionally (`vite build renderer`),
// so this config sits at renderer/ and resolves src/ + public/ relative to it.
//
// Served by the Electron app:// custom protocol (see src/main/protocol.ts), which
// treats '/' as the renderer root — hence base '/'. Vue Router runs in HASH mode,
// so every navigation is still just /index.html (no server-side SPA fallback needed).
//
// outDir 'dist' → renderer/dist (NOT desktop/dist, which is electron-builder's output).
// assetsDir 'build' keeps Vite's hashed bundles in /build/* so they never clash with
// the verbatim runtime assets copied from public/ into /assets/*.
export default defineConfig({
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'build',
    emptyOutDir: true,
    target: 'chrome120', // Electron 42 ships a modern Chromium — no legacy transpile
    chunkSizeWarningLimit: 2000,
  },
})
