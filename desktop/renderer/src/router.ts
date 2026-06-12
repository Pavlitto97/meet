import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

// HASH routing: every navigation is still app://meet/index.html#/... so the custom
// protocol needs no SPA fallback, and the /api/render preview window (app://meet/api/...)
// never collides with a client route.
const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/admin' },
  {
    path: '/admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { css: 'admin', title: 'Meet — адмін-панель' },
    redirect: '/admin/groups',
    children: [
      { path: 'groups', component: () => import('@/components/admin/GroupsTab.vue'), meta: { tab: 'groups' } },
      { path: 'groups/:id(\\d+)', component: () => import('@/components/admin/GroupDetailTab.vue'), meta: { tab: 'groups' } },
      { path: 'generations', component: () => import('@/components/admin/GenerationsTab.vue'), meta: { tab: 'generations' } },
      { path: 'screenshots', component: () => import('@/components/admin/ScreenshotsTab.vue'), meta: { tab: 'screenshots' } },
      { path: 'settings', component: () => import('@/components/admin/SettingsTab.vue'), meta: { tab: 'settings' } },
      { path: 'prompt', component: () => import('@/components/admin/PromptTab.vue'), meta: { tab: 'prompt' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/admin' },
]

const router = createRouter({ history: createWebHashHistory(), routes })

// Single admin stylesheet, attached once. (The legacy editor's app.css is gone;
// keeping the <link id="view-css"> hook so a future view could swap it.)
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
