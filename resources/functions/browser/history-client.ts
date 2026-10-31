/**
 * The screen's side of history: it watches what pages report, turns finished
 * loads into visits, and sends them to the agent (`app/Desktop/Agent.ts`) a
 * second at a time, so a burst of redirects is one request. Searching asks the
 * agent, whose index is what makes it fast.
 */

import type { Candidate } from './rank'

/** What a page reports (`craft.web.on('state')`), as far as history cares. */
export interface PageReport { tab: string, url?: string, title?: string, loading?: boolean }

export interface HistoryClientOptions {
  /** The agent's origin (`craft.app.url`). */
  base: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** How long visits wait to be sent together. Default 1000 ms. */
  flushAfter?: number
  now?: () => number
  /** Tabs whose pages are not remembered (a private window). */
  isPrivate?: (tab: string) => boolean
}

export interface HistoryClient {
  /** Feed every page report here; it records a visit once a new address finishes loading. */
  report: (page: PageReport) => void
  /** Matches for the command bar, most used first; empty when the agent cannot answer. */
  search: (text: string, limit?: number) => Promise<Candidate[]>
  /** A closed tab's last address is forgotten, so reopening it counts again. */
  forgetTab: (tab: string) => void
  flush: () => Promise<void>
}

export function createHistoryClient(options: HistoryClientOptions): HistoryClient {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const now = options.now ?? Date.now
  const base = options.base.replace(/\/+$/, '')
  const flushAfter = options.flushAfter ?? 1000
  /** The address each tab last recorded, and that visit's title. */
  const recorded = new Map<string, { url: string, title: string }>()
  let visits: Array<{ url: string, title?: string, at: number }> = []
  let titles: Array<{ url: string, title: string }> = []
  let timer: ReturnType<typeof setTimeout> | null = null

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = null
    if (!visits.length && !titles.length) return
    const body = JSON.stringify({ visits, titles })
    visits = []
    titles = []
    try {
      await send(`${base}/api/history`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    }
    // History is a convenience: a page that could not be recorded is not worth an error.
    catch {}
  }

  function schedule(): void {
    if (!timer) timer = setTimeout(() => { void flush() }, flushAfter)
  }

  return {
    report(page) {
      if (!page.url || !/^https?:\/\//i.test(page.url) || options.isPrivate?.(page.tab)) return
      const last = recorded.get(page.tab)
      if (last?.url === page.url) {
        if (page.title && page.title !== last.title) {
          last.title = page.title
          titles.push({ url: page.url, title: page.title })
          schedule()
        }
        return
      }
      if (page.loading !== false) return
      recorded.set(page.tab, { url: page.url, title: page.title ?? '' })
      visits.push({ url: page.url, at: now(), ...(page.title ? { title: page.title } : {}) })
      schedule()
    },

    async search(text, limit = 8) {
      const query = text.trim()
      if (!query) return []
      try {
        // Unsent visits first, so what was just opened can already be found.
        await flush()
        const response = await send(`${base}/api/history?q=${encodeURIComponent(query)}&limit=${limit}`)
        if (!response.ok) return []
        const { data } = await response.json() as { data: Array<{ url: string, title: string, frecency: number }> }
        return data.map(page => ({ kind: 'history', id: page.url, title: page.title, url: page.url, frecency: page.frecency }))
      }
      catch { return [] }
    },

    forgetTab: tab => void recorded.delete(tab),
    flush,
  }
}
