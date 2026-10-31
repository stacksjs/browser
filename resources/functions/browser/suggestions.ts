/**
 * The command bar's search suggestions, asked of the agent (app/Desktop/suggest.ts)
 * so the window's own requests stay on loopback.
 */

import type { SearchEngineName } from './address'
import { searchURL } from './address'
import type { Candidate } from './rank'

export interface SuggestionClientOptions {
  base: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

export function createSuggestionClient(options: SuggestionClientOptions) {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  /** Suggestions for `text` as candidates that search for themselves; none when the agent or engine cannot answer. */
  return async function suggest(text: string, engine: SearchEngineName = 'google'): Promise<Candidate[]> {
    const query = text.trim()
    if (!query) return []
    try {
      const response = await send(`${base}/api/suggest?engine=${engine}&q=${encodeURIComponent(query)}`)
      if (!response.ok) return []
      const { data } = await response.json() as { data: string[] }
      return data.map(each => ({ kind: 'suggestion', id: `suggest:${each}`, title: each, url: searchURL(each, engine) }))
    }
    catch { return [] }
  }
}
