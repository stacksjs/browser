/**
 * The sidebar, kept by the agent (`app/Desktop/Agent.ts`). The screen holds
 * the state in one signal, and every change is a new object only where
 * something changed (sidebar.ts), so what to send is a comparison of
 * references: no deep walk, and a title update sends one row.
 */

import type { BrowserState, Item, Space } from './sidebar'

/** What changed between two states. Absent fields did not change. */
export interface SessionChange {
  /** All spaces, in order, whenever any of them changed. */
  spaces?: Space[]
  /** Rows added or changed. */
  put?: Item[]
  /** Rows that left the sidebar. */
  remove?: string[]
  activeSpace?: string
  selected?: Record<string, string | null>
  closed?: Item[]
}

/** The change from `previous` to `next`; `null` when there is none. Without `previous`, everything. */
export function diffSession(previous: BrowserState | null, next: BrowserState): SessionChange | null {
  if (previous === next) return null
  const change: SessionChange = {}
  if (!previous || previous.spaces !== next.spaces) change.spaces = next.spaces
  if (!previous || previous.activeSpace !== next.activeSpace) change.activeSpace = next.activeSpace
  if (!previous || previous.selected !== next.selected) change.selected = next.selected
  if (!previous || previous.closed !== next.closed) change.closed = next.closed
  if (!previous || previous.items !== next.items) {
    const before = previous?.items ?? {}
    const put = Object.values(next.items).filter(item => before[item.id] !== item)
    const remove = Object.keys(before).filter(id => !(id in next.items))
    if (put.length) change.put = put
    if (remove.length) change.remove = remove
  }
  return Object.keys(change).length ? change : null
}

export interface SessionClientOptions {
  /** The agent's origin (`craft.app.url`). */
  base: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** How long changes wait to be sent together. Default 400 ms. */
  flushAfter?: number
}

export interface SessionClient {
  /** The saved sidebar, or `null` when nothing is saved yet. Throws when the agent cannot answer. */
  load: () => Promise<BrowserState | null>
  /** Remember `state`; it is sent with whatever else changes in the next moment. */
  save: (state: BrowserState) => void
  /** Send what is waiting now. Resolves `false` if the agent did not take it (it is sent again next time). */
  flush: () => Promise<boolean>
}

export function createSessionClient(options: SessionClientOptions): SessionClient {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  const flushAfter = options.flushAfter ?? 400
  /** What the agent has: changes are measured from here, and it moves only once a save lands. */
  let stored: BrowserState | null = null
  let latest: BrowserState | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let sending: Promise<boolean> | null = null

  async function flush(): Promise<boolean> {
    if (timer) clearTimeout(timer)
    timer = null
    // One request at a time, so two saves never land out of order.
    if (sending) await sending
    const next = latest
    const change = next ? diffSession(stored, next) : null
    if (!next || !change) return true
    sending = (async () => {
      try {
        const response = await send(`${base}/api/session`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) })
        if (response.ok) stored = next
        return response.ok
      }
      catch { return false }
    })()
    try { return await sending }
    finally { sending = null }
  }

  return {
    async load() {
      const response = await send(`${base}/api/session`)
      if (!response.ok) throw new Error(`The agent could not load the session (${response.status})`)
      const { data } = await response.json() as { data: BrowserState | null }
      stored = data
      latest = data
      return data
    },
    save(state) {
      latest = state
      if (!timer) timer = setTimeout(() => { void flush() }, flushAfter)
    },
    flush,
  }
}
