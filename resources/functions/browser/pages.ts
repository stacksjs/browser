/**
 * Which tabs have a page in the host. A restored session creates none: a tab
 * gets its page the first time it is shown, and gives it up when it sleeps
 * (hibernation.ts), so fifty restored tabs cost what the visible one costs.
 */

import type { TabActivity } from './hibernation'
import type { BrowserState, Item } from './sidebar'

/** The part of `craft.web` this needs. */
export interface WebTabs {
  create: (options: { id: string, url?: string, profile?: string, private?: boolean }) => Promise<unknown>
  close: (id: string) => Promise<unknown>
}

export interface Pages {
  /** The tab has a page now (or is getting one). */
  has: (id: string) => boolean
  /** Give a tab its page if it has none; resolves once the host has it. */
  show: (tab: Item, profile: string, now?: number) => Promise<unknown>
  /** A page the host already made for the tab (`window.open`, `target=_blank`). */
  adopt: (id: string, now?: number) => void
  /** Let tabs' pages go; their rows stay, and showing them again reloads them. */
  release: (ids: string[]) => Promise<void>
  /** Stop counting a page as this window's without closing it: another window shows it now, or it closed with one. */
  forget: (id: string) => void
  /** Forget every page the host no longer has (`live` is what `craft.web.list` answers). */
  prune: (live: Set<string>) => void
  /** What hibernation weighs: every tab with a page, and when it was last shown. */
  activity: (state: BrowserState, visible: Set<string>, busy: Set<string>) => TabActivity[]
}

export function createPages(web: WebTabs, options: { private?: boolean } = {}): Pages {
  const shownAt = new Map<string, number>()
  const creating = new Map<string, Promise<unknown>>()
  const forget = (id: string) => {
    creating.delete(id)
    shownAt.delete(id)
  }
  return {
    has: id => creating.has(id),
    show(tab, profile, now = Date.now()) {
      shownAt.set(tab.id, now)
      let page = creating.get(tab.id)
      if (!page) {
        page = web.create({ id: tab.id, ...(tab.url ? { url: tab.url } : {}), profile, ...(options.private ? { private: true } : {}) })
        // A page that failed to appear can be asked for again on the next show.
        page.catch(() => creating.delete(tab.id))
        creating.set(tab.id, page)
      }
      return page
    },
    adopt(id, now = Date.now()) {
      shownAt.set(id, now)
      creating.set(id, Promise.resolve())
    },
    async release(ids) {
      await Promise.all(ids.filter(id => creating.has(id)).map((id) => {
        creating.delete(id)
        shownAt.delete(id)
        return web.close(id).catch(() => {})
      }))
    },
    forget,
    prune(live) {
      for (const id of [...creating.keys()]) if (!live.has(id)) forget(id)
    },
    activity(state, visible, busy) {
      return [...creating.keys()].flatMap((id) => {
        const item = state.items[id]
        if (!item) return []
        return [{ id, lastActiveAt: Math.max(item.lastActiveAt, shownAt.get(id) ?? 0), live: true, visible: visible.has(id), busy: busy.has(id), pinned: item.section !== 'today' }]
      })
    },
  }
}
