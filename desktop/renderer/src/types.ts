// Domain types mirroring the backend JSON shapes (see src/main/services/*).
// Integer columns come back as 0/1 numbers (ATTR_STRINGIFY_FETCHES=false).

export interface Group {
  id: number
  name: string
  created_at?: string
  has_slide: 0 | 1
  participants: number
  editable: number | null
  with_source: number | null
  with_avatar: number | null
  with_avatar_end: number | null
  generations: number
  active: 0 | 1
}

export interface Participant {
  id: number
  group_id: number
  device_id: string
  original_name: string
  custom_name: string | null
  has_source: 0 | 1
  has_avatar: 0 | 1
  has_avatar_end: 0 | 1
  skipped: 0 | 1
  position: number
  user_added: 0 | 1
  deleted: 0 | 1
}

export type GenStatus = 'pending' | 'done' | 'error'

export interface Generation {
  id: number
  participant_id: number | null
  participant_name: string | null
  group_id: number | null
  group_name: string | null
  prompt?: string
  model: string
  provider: string
  service_tier: string
  status: GenStatus
  error: string | null
  has_image: 0 | 1
  has_input: 0 | 1
  retouched: 0 | 1
  cost_usd: number | null
  prompt_tokens: number | null
  output_tokens: number | null
  degrade_pct: number | null
  approved_at: string | null
  created_at?: string
}

/** Узагальнене джерело для CropModal: будь-яке зображення, яке можна вирізати
 *  й застосувати аватаркою початку/кінця — генерація (повнорозмірний колаж) АБО
 *  власне фото учасника (коли генерації немає). Дані-only: модалка сама шле POST. */
export interface CropSubject {
  title: string
  meta?: string[]
  // URL зображення, у coordinate-space якого користувач задає рамку (натуральні px).
  imgSrc: string
  // POST-ціль; тіло = { which, x, y, width, height, ...(from ? { from } : {}) }.
  endpoint: string
  // Для кропу фото учасника (яке саме джерело різати); для генерації — відсутнє.
  from?: 'start' | 'end' | 'source'
  // Показати бейдж «застосовано» в шапці.
  applied?: boolean
}

export interface Screenshot {
  id: number
  which: 'start' | 'end'
  width: number
  height: number
  size_bytes: number
  meeting_code: string | null
  label: string | null
  created_at: string
  has_image: 0 | 1
  group_id: number | null
  group_name: string | null
}

export interface Settings {
  meeting_code?: string
  // 24-годинний формат «HH:MM» (без AM/PM).
  start_time?: string
  end_time?: string
  active_group_id?: string | number
  gen_model?: string
  gen_provider?: string
  gen_tier?: string
  gen_degrade?: string | number
  gen_degrade_method?: string
  gen_degrade_min?: string | number
  gen_degrade_max?: string | number
  gen_resize?: string | number
  gen_resize_w?: string | number
  gen_resize_h?: string | number
  cam_method?: string
  cam_intensity?: string | number
  openrouter_api_key_set?: boolean
  [k: string]: unknown
}

export interface Preset {
  id: number
  name: string
  body: string
  created_at?: string
  updated_at?: string
}

export interface Credits {
  total_credits?: number
  total_usage?: number
  data?: { total_credits?: number; total_usage?: number }
}
