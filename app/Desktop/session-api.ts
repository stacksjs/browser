import type { SessionChange } from '../../resources/functions/browser/session'
import type { Item, Space } from '../../resources/functions/browser/sidebar'
import { CLOSED_LIMIT } from '../../resources/functions/browser/sidebar'
import type { Session } from './session'

/** More rows than any sidebar holds; a request past it is not from the screen. */
const MAX_ITEMS = 10_000

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
const isString = (value: unknown): value is string => typeof value === 'string'
const isRecord = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const optionalString = (value: unknown) => value === undefined || value === null || isString(value)

function isItem(value: unknown): value is Item {
  return isRecord(value) && isString(value.id) && ['tab', 'folder', 'split'].includes(value.kind) && ['favorites', 'pinned', 'today'].includes(value.section)
    && optionalString(value.space) && optionalString(value.parent) && isString(value.order)
    && Number.isFinite(value.createdAt) && Number.isFinite(value.lastActiveAt)
    && ['title', 'name', 'url', 'savedUrl', 'icon'].every(key => optionalString(value[key]))
}

function isSpace(value: unknown): value is Space {
  return isRecord(value) && isString(value.id) && isString(value.name) && isString(value.profile) && isRecord(value.theme) && optionalString(value.icon)
}

/** The change as sent, or why it is not one. Unknown fields are dropped. */
export function sessionChangeFrom(body: unknown): SessionChange | string {
  if (!isRecord(body)) return 'Expected an object'
  const change: SessionChange = {}
  if (body.spaces !== undefined) {
    if (!Array.isArray(body.spaces) || !body.spaces.length || !body.spaces.every(isSpace)) return 'spaces: expected at least one space'
    change.spaces = body.spaces
  }
  if (body.put !== undefined) {
    if (!Array.isArray(body.put) || body.put.length > MAX_ITEMS || !body.put.every(isItem)) return 'put: expected sidebar items'
    change.put = body.put
  }
  if (body.remove !== undefined) {
    if (!Array.isArray(body.remove) || body.remove.length > MAX_ITEMS || !body.remove.every(isString)) return 'remove: expected item ids'
    change.remove = body.remove
  }
  if (body.activeSpace !== undefined) {
    if (!isString(body.activeSpace)) return 'activeSpace: expected a space id'
    change.activeSpace = body.activeSpace
  }
  if (body.selected !== undefined) {
    if (!isRecord(body.selected) || !Object.values(body.selected).every(id => id === null || isString(id))) return 'selected: expected tab ids by space'
    change.selected = body.selected
  }
  if (body.closed !== undefined) {
    if (!Array.isArray(body.closed) || !body.closed.every(isItem)) return 'closed: expected sidebar items'
    change.closed = body.closed.slice(-CLOSED_LIMIT)
  }
  return change
}

/**
 * The sidebar over the app's loopback agent, which only the app's own window
 * can reach (session cookie and Host check). `session` opens on first use.
 */
export function sessionApi(session: () => Session) {
  return {
    /** `GET`: the saved sidebar, or `{ data: null }` before the first save. */
    load: (): Response => json({ data: session().load() }),

    /** `GET ?limit=100`: tabs that left the sidebar, newest first, for the Library. */
    archived(request: Request): Response {
      const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get('limit')) || 100, 1), 500)
      return json({ data: session().archived(limit).filter(item => item.kind === 'tab' && item.url) })
    },

    /** `PUT` a `SessionChange`: what changed since the last save. */
    async save(request: Request): Promise<Response> {
      let body: unknown
      try { body = await request.json() }
      catch { return json({ error: 'Expected JSON' }, 400) }
      const change = sessionChangeFrom(body)
      if (typeof change === 'string') return json({ error: change }, 422)
      session().save(change)
      return new Response(null, { status: 204 })
    },
  }
}
