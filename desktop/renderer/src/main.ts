import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// Global stylesheets. flatpickr base + the project's dark theme (copied verbatim from
// the old vendored dark.css). app.css / admin.css are NOT imported here — they are
// swapped per-route by router.afterEach so their overlapping tokens never collide.
import 'flatpickr/dist/flatpickr.css'
import './styles/flatpickr-dark.css'

createApp(App).use(createPinia()).use(router).mount('#app')
