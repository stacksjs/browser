/**
 * Several windows, one sidebar. Every window shows the same spaces, pinned
 * tabs, Today tabs and recently closed tabs; each keeps its own space and
 * selected tab. A window sends the shared part of each change to the others
 * (`craft.desktop.post`), and the window that made a change is the one that
 * saves it, so a change reaches the agent once.
 *
 * A page is one WKWebView, which can be in one window at a time. Windows say
 * which tabs they are showing; a tab shown elsewhere is drawn as a card with
 * "Show Here", which asks the other window to let it go.
 */

import type { SessionChange } from './session'
import type { BrowserState, Item, Space } from './sidebar'

/** What every window shares: rows, spaces and closed tabs, never which space or tab a window shows. */
export interface SharedChange {
  spaces?: Space[]
  put?: Item[]
  remove?: string[]
  closed?: Item[]
}

/** What windows tell each other. */
export type WindowMessage =
  /** `replace`: the whole shared sidebar, answering a new window's hello. */
  | { type: 'sidebar', change: SharedChange, replace?: boolean }
  /** A window just opened: the others answer with what they show, and one sends the whole sidebar. */
  | { type: 'hello' }
  | { type: 'showing', tabs: string[] }
  /** The sender wants to show `tab`, which the receiver is showing. */
  | { type: 'take', tab: string }

/** The shared part of a change; `null` when it only moved this window's space or selection. */
export function sharedChange(change: SessionChange | null): SharedChange | null {
  if (!change) return null
  const shared: SharedChange = {}
  if (change.spaces) shared.spaces = change.spaces
  if (change.put) shared.put = change.put
  if (change.remove) shared.remove = change.remove
  if (change.closed) shared.closed = change.closed
  return Object.keys(shared).length ? shared : null
}

/** The whole shared sidebar as a change, for a window that just opened. */
export function snapshot(state: BrowserState): SharedChange {
  return { spaces: state.spaces, put: Object.values(state.items), closed: state.closed }
}

/**
 * Another window's change applied here. This window keeps its own space and
 * selection, moved only when the change removed what they pointed at. A
 * snapshot (`replace`) also drops rows the sender no longer has.
 */
export function applySharedChange(state: BrowserState, change: SharedChange, options: { replace?: boolean } = {}): BrowserState {
  let items = state.items
  const removed = new Set(change.remove ?? [])
  if (options.replace && change.put) {
    const kept = new Set(change.put.map(item => item.id))
    for (const id of Object.keys(items)) if (!kept.has(id)) removed.add(id)
  }
  if (change.put?.length || removed.size) {
    items = { ...items }
    for (const id of removed) delete items[id]
    for (const item of change.put ?? []) items[item.id] = item
  }

  const spaces = change.spaces ?? state.spaces
  const activeSpace = spaces.some(space => space.id === state.activeSpace) ? state.activeSpace : spaces[0]?.id ?? state.activeSpace
  let selected = state.selected
  const stale = spaces.some(space => !(space.id in selected))
    || Object.keys(selected).some(id => !spaces.some(space => space.id === id))
    || Object.values(selected).some(id => id !== null && !(id in items))
  if (stale) selected = Object.fromEntries(spaces.map((space) => {
    const id = selected[space.id] ?? null
    return [space.id, id !== null && id in items ? id : null]
  }))

  const closed = change.closed ?? state.closed
  if (items === state.items && spaces === state.spaces && activeSpace === state.activeSpace && selected === state.selected && closed === state.closed) return state
  return { ...state, items, spaces, activeSpace, selected, closed }
}

/**
 * What a window that is not the main one saves: the shared sidebar with the
 * main window's space and selection left as they were, so the next launch
 * opens where the main window was.
 */
export function withView(state: BrowserState, view: Pick<BrowserState, 'activeSpace' | 'selected'>): BrowserState {
  return state.activeSpace === view.activeSpace && state.selected === view.selected ? state : { ...state, activeSpace: view.activeSpace, selected: view.selected }
}

/** Every tab the other windows say they show. */
export function shownElsewhere(windows: Record<string, string[]>): Set<string> {
  return new Set(Object.values(windows).flat())
}

/** Reads a message from another window, or `null` for anything else posted (the Little window's handoff). */
export function windowMessage(message: unknown): WindowMessage | null {
  if (!message || typeof message !== 'object') return null
  const value = message as Record<string, unknown>
  switch (value.type) {
    case 'sidebar': return value.change && typeof value.change === 'object' ? { type: 'sidebar', change: value.change as SharedChange, ...(value.replace === true ? { replace: true } : {}) } : null
    case 'hello': return { type: 'hello' }
    case 'showing': return Array.isArray(value.tabs) ? { type: 'showing', tabs: value.tabs.filter((tab): tab is string => typeof tab === 'string') } : null
    case 'take': return typeof value.tab === 'string' ? { type: 'take', tab: value.tab } : null
    default: return null
  }
}
