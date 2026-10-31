import type { History, HistoryTitle, HistoryVisit } from './history'

/** The most one request may carry: a screen flushes every second, so this is generous. */
const MAX_BATCH = 500

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })

function visitsFrom(value: unknown): HistoryVisit[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_BATCH).flatMap((each) => {
    if (!each || typeof each.url !== 'string' || !Number.isFinite(each.at)) return []
    return [{ url: each.url, at: Number(each.at), ...(typeof each.title === 'string' ? { title: each.title } : {}) }]
  })
}

function titlesFrom(value: unknown): HistoryTitle[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_BATCH).flatMap(each => each && typeof each.url === 'string' && typeof each.title === 'string' ? [{ url: each.url, title: each.title }] : [])
}

/**
 * History over the app's loopback agent. Only the app's own window can reach
 * it (the agent checks its session cookie and Host), so these take no further
 * auth. `history` is a function so the database opens on first use.
 */
export function historyApi(history: () => History) {
  return {
    /** `GET ?q=text&limit=8`: matches, most used first. No `q`: the latest pages. */
    search(request: Request): Response {
      const params = new URL(request.url).searchParams
      const limit = Math.min(Math.max(Number(params.get('limit')) || 8, 1), 100)
      const text = params.get('q')?.trim() ?? ''
      return json({ data: text ? history().search(text, limit) : history().recent(limit) })
    },

    /** `POST { visits: [{ url, title?, at }], titles: [{ url, title }] }`. */
    async record(request: Request): Promise<Response> {
      let body: { visits?: unknown, titles?: unknown }
      try { body = await request.json() as typeof body }
      catch { return json({ error: 'Expected JSON' }, 400) }
      const visits = visitsFrom(body?.visits)
      const titles = titlesFrom(body?.titles)
      if (visits.length) history().record(visits)
      if (titles.length) history().retitle(titles)
      return new Response(null, { status: 204 })
    },

    /** `DELETE ?url=...` forgets one page; with no `url`, all of them. */
    forget(request: Request): Response {
      const url = new URL(request.url).searchParams.get('url')
      if (url) history().forget(url)
      else history().clear()
      return new Response(null, { status: 204 })
    },
  }
}
