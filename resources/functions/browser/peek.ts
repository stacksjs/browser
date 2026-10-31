/**
 * Peek, as Arc had it: a link out of a pinned tab or a favorite to another
 * site opens over the page instead of as a new tab, so the pinned app stays
 * where it was. "Open as Tab" keeps it; closing it lets it go.
 */

import { siteKey } from './sites'
import type { BrowserState } from './sidebar'

/** Should a link from `fromTab` to `url` open in Peek? */
export function shouldPeek(state: BrowserState, fromTab: string, url: string): boolean {
  const from = state.items[fromTab]
  if (!from || from.kind !== 'tab' || from.section === 'today') return false
  const target = siteKey(url)
  const source = siteKey(from.url)
  return Boolean(target && source && target !== source)
}
