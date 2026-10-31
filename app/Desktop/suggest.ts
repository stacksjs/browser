/**
 * Search suggestions for the command bar, asked of the search engine by the
 * agent (the window's own fetches stay on loopback). Answers are cached for a
 * while, and an engine that is slow or down answers nothing rather than an error.
 */

import type { SearchEngineName } from '../../resources/functions/browser/address'
import { SEARCH_ENGINES } from '../../resources/functions/browser/address'

export interface SuggestionsOptions {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** Default 800 ms: a suggestion later than that is no use while typing. */
  timeoutMs?: number
  /** Answers kept, newest replacing oldest. Default 200. */
  cacheSize?: number
  /** How long an answer stays fresh. Default 10 minutes. */
  maxAgeMs?: number
  now?: () => number
}

/** The engine's OpenSearch answer, `[query, [suggestions...]]`, as a list. */
export function parseSuggestions(body: unknown): string[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return []
  return body[1].filter((each): each is string => typeof each === 'string' && each.length > 0 && each.length < 200)
}

export function createSuggestions(options: SuggestionsOptions = {}) {
  const send = options.fetch ?? ((url, init) => fetch(url, init))
  const timeoutMs = options.timeoutMs ?? 800
  const cacheSize = options.cacheSize ?? 200
  const maxAgeMs = options.maxAgeMs ?? 600_000
  const now = options.now ?? Date.now
  const cache = new Map<string, { at: number, list: string[] }>()

  return async function suggest(text: string, engine: SearchEngineName = 'google', limit = 5): Promise<string[]> {
    const query = text.trim().slice(0, 200)
    const endpoint = SEARCH_ENGINES[engine]?.suggest
    if (!query || !endpoint) return []
    const key = `${engine}:${query.toLowerCase()}`
    const hit = cache.get(key)
    if (hit && now() - hit.at < maxAgeMs) return hit.list.slice(0, limit)
    try {
      const response = await send(endpoint.replace('%s', encodeURIComponent(query)), { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
      if (!response.ok) return []
      const list = parseSuggestions(await response.json()).filter(each => each.toLowerCase() !== query.toLowerCase())
      cache.delete(key)
      cache.set(key, { at: now(), list })
      if (cache.size > cacheSize) cache.delete(cache.keys().next().value!)
      return list.slice(0, limit)
    }
    catch { return [] }
  }
}

/** `GET /api/suggest?q=text&engine=google`. */
export function suggestApi(suggest: ReturnType<typeof createSuggestions>) {
  return {
    async get(request: Request): Promise<Response> {
      const params = new URL(request.url).searchParams
      const engine = (params.get('engine') ?? 'google') as SearchEngineName
      return Response.json({ data: await suggest(params.get('q') ?? '', engine) }, { headers: { 'cache-control': 'no-store' } })
    },
  }
}
