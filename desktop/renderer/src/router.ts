import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

// HASH routing: every navigation is still app://meet/index.html#/... so the custom
// protocol needs no SPA fallback, and the /api/render preview window (app://meet/api/...)
// never collides with a client route.
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/editor' },
  {
    path: '/editor',
    component: () => import('@/views/EditorView.vue'),
    meta: { css: 'app', title: 'Meet — редактор' },
  },
  {
    path: '/admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { css: 'admin', title: 'Meet — адмін-панель' },
    redirect: '/admin/participants',
    children: [
      { path: 'participants', component: () => import('@/components/admin/ParticipantsTab.vue'), meta: { tab: 'participants' } },
      { path: 'generations', component: () => import('@/components/admin/GenerationsTab.vue'), meta: { tab: 'generations' } },
      { path: 'screenshots', component: () => import('@/components/admin/ScreenshotsTab.vue'), meta: { tab: 'screenshots' } },
      { path: 'settings', component: () => import('@/components/admin/SettingsTab.vue'), meta: { tab: 'settings' } },
      { path: 'prompt', component: () => import('@/components/admin/PromptTab.vue'), meta: { tab: 'prompt' } },
    ],
  },
  {
    path: '/degrade-lab',
    component: () => import('@/views/DegradeLabView.vue'),
    meta: { css: 'admin', title: 'Meet — лабораторія деградації' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/editor' },
]

const router = createRouter({ history: createWebHashHistory(), routes })

// Per-route stylesheet swap. app.css (editor) and admin.css (admin + lab) define the
// SAME :root var names with DIFFERENT values, so loading both globally would re-theme
// each other. Since router-view mounts one view at a time, we keep exactly one active
// <link id="view-css">. Appended at runtime → wins over the bundled flatpickr CSS.
function applyViewCss(name: string): void {
  let link = document.getElementById('view-css') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = 'view-css'
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  const href = `/assets/css/${name === 'app' ? 'app' : 'admin'}.css`
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
}

router.afterEach((to) => {
  applyViewCss((to.meta.css as string) || 'admin')
  if (to.meta.title) document.title = to.meta.title as string
})

export default router
