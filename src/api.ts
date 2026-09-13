import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const configured = Boolean(url && key)
export const supabase = configured
  ? createClient(url, key, {
      db: { schema: 'agape' },
      auth: { flowType: 'pkce', storageKey: 'agape.auth', detectSessionInUrl: true },
    })
  : null
export function db() {
  if (!supabase)
    throw new Error(
      'Agape is not configured. Add the two browser settings from .env.example to .env.local.',
    )
  return supabase
}
export async function result<T>(
  request: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
): Promise<T> {
  const { data, error } = await request
  if (error) {
    if (error.code === 'PGRST106' || error.code === 'PGRST202' || error.code === '42P01') {
      throw new Error(
        'Agape’s database is not ready. Apply its migrations and expose the agape schema in Supabase API settings.',
      )
    }
    throw new Error(error.message)
  }
  return data as T
}
export interface Topic {
  node_id: string
  parent_id: string | null
  name: string
  description: string
  slug: string
  is_fallback: boolean
  child_count?: number
  edge_type?: string
}
export interface Video {
  video_id: string
  channel_id: string
  title: string
  channel_title: string
  duration_seconds: number
}
export interface Fragment {
  node_id?: string
  curated?: boolean
  id: string
  video_id: string
  title: string
  video_title: string
  channel_title: string
  start_seconds: number
  end_seconds: number
}
export interface Cue {
  section_id?: string
  revision?: number
  track?: string
  id: string
  video_id: string
  locale: string
  start_seconds: number
  end_seconds: number
  markdown: string
}
export interface Browse {
  node: Topic | null
  breadcrumbs: Topic[]
  topics: Topic[]
  related: Topic[]
  videos: Video[]
  fragments: Fragment[]
  tags: { tag_id: string; kind: string; name: string }[]
  locales: { locale: string; name: string; direction: string }[]
}
export interface VideoDetail {
  video: Video | null
  creator_id: string | null
  topics: Topic[]
  cues: Cue[]
  comments: { id: string; user_id: string; body: string; author: string; created_at: string }[]
  can_comment: boolean
  is_owner: boolean
}
export function browse(
  node: string | null,
  locale = 'en',
  query = '',
  tag: string | null = null,
  descendants = true,
) {
  return result<Browse>(
    db().rpc('browse', {
      p_node: node,
      p_locale: locale,
      p_query: query,
      p_tag: tag,
      p_descendants: descendants,
    }),
  )
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
