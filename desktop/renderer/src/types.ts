// Domain types mirroring the backend JSON shapes (see src/main/services/*).
// Integer columns come back as 0/1 numbers (ATTR_STRINGIFY_FETCHES=false).

export interface Participant {
  device_id: string
  original_name: string
  custom_name: string | null
  has_avatar: 0 | 1
  has_avatar_end: 0 | 1
  skipped: 0 | 1
  position: number
  user_added: 0 | 1
}

export type GenStatus = 'pending' | 'done' | 'error'

export interface Generation {
  id: number
  participant_id: string | null
  participant_name: string | null
  prompt?: string
  model: string
  provider: string
  service_tier: string
  status: GenStatus
  error: string | null
  has_image: 0 | 1
  has_input: 0 | 1
  cost_usd: number | null
  prompt_tokens: number | null
  output_tokens: number | null
  degrade_pct: number | null
  created_at?: string
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
}

export interface Settings {
  meeting_code?: string
  start_time?: string
  start_period?: string
  end_time?: string
  end_period?: string
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

export interface DegradeMethod {
  key: string
  label: string
  layer: 'none' | 'server' | 'browser'
  desc: string
}

export interface DegradeSpec {
  method?: string
  intensity?: number
  layer?: string
  filter: string
  svg: string
}

export interface Credits {
  total_credits?: number
  total_usage?: number
  data?: { total_credits?: number; total_usage?: number }
}
