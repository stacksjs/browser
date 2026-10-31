import type { DownloadRecord } from '../../resources/functions/browser/library'
import type { Downloads } from './downloads'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
const STATES = ['started', 'finished', 'failed', 'cancelled']

/** The download as sent, or null when it is not one. */
export function downloadFrom(value: any): DownloadRecord | null {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 64 || !STATES.includes(value.state)) return null
  const text = (key: string) => (typeof value[key] === 'string' ? value[key] as string : '')
  const count = (key: string) => (Number.isFinite(value[key]) && value[key] >= 0 ? Number(value[key]) : 0)
  return {
    id: value.id, url: text('url'), path: text('path'), name: text('name'), state: value.state,
    received: count('received'), total: count('total'), startedAt: count('startedAt'),
    ...(count('finishedAt') ? { finishedAt: count('finishedAt') } : {}),
  }
}

/** Downloads over the app's loopback agent, which only its own window can reach. */
export function downloadsApi(downloads: () => Downloads) {
  return {
    /** `GET ?limit=100`: newest first. */
    list(request: Request): Response {
      const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 100, 1), 500)
      return json({ data: downloads().list(limit) })
    },
    /** `POST` a download's latest state. */
    async record(request: Request): Promise<Response> {
      let body: unknown
      try { body = await request.json() }
      catch { return json({ error: 'Expected JSON' }, 400) }
      const download = downloadFrom(body)
      if (!download) return json({ error: 'Expected a download' }, 422)
      downloads().record(download)
      return new Response(null, { status: 204 })
    },
    /** `DELETE`: forget the ones that ended. */
    clear(): Response {
      downloads().clear()
      return new Response(null, { status: 204 })
    },
  }
}
