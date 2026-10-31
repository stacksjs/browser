/**
 * Arc's sidebar, brought over: spaces with their colours and icons, pinned tabs
 * and folders, split views, Today's tabs, and favorites, from Arc's
 * `StorableSidebar.json`. Read from a copy; Arc's own files are never written.
 *
 * Arc stores most lists as alternating keys and values (`[id, item, id, item]`)
 * and nests enums as `{ case: { _0: value } }`; the helpers below read both.
 */

import type { BrowserState, Item, Palette, Section, Space, SpaceTheme } from './sidebar'
import { keysBetween } from './order'
import { DEFAULT_THEME } from './sidebar'

type Json = Record<string, any>

export interface ArcImportReport {
  spaces: number
  pinned: number
  today: number
  favorites: number
  folders: number
  splits: number
  /** What Arc had that this browser does not (easels, notes), by kind. */
  skipped: Record<string, number>
}

/** `[key, value, key, value]` as pairs. */
function pairs<T = Json>(list: unknown): Array<[unknown, T]> {
  if (!Array.isArray(list)) return []
  const out: Array<[unknown, T]> = []
  for (let index = 0; index + 1 < list.length; index += 2) out.push([list[index], list[index + 1] as T])
  return out
}

/** Arc's colours are 0-1 components. */
function hex(color: Json | undefined, fallback: string): string {
  if (!color || typeof color.red !== 'number') return fallback
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')
  const alpha = typeof color.alpha === 'number' && color.alpha < 0.995 ? channel(color.alpha) : ''
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}${alpha}`
}

/** A colour moved `amount` of the way towards another, for the background's second stop. */
function mix(a: string, b: string, amount: number): string {
  const parse = (value: string) => [1, 3, 5].map(at => Number.parseInt(value.slice(at, at + 2), 16))
  const [x, y] = [parse(a), parse(b)]
  return `#${x.map((channel, index) => Math.round(channel + (y[index]! - channel) * amount).toString(16).padStart(2, '0')).join('')}`
}

function palette(colors: Json | undefined, fallback: Palette): Palette {
  if (!colors) return fallback
  const background = hex(colors.cutoutColor ?? colors.minContrastColor, fallback.background).slice(0, 7)
  const deep = hex(colors.maxContrastColor, fallback.foreground).slice(0, 7)
  return {
    background,
    backgroundTo: mix(background, deep, 0.12),
    foreground: hex(colors.title, fallback.foreground),
    hover: hex(colors.hover, fallback.hover),
    selected: hex(colors.backgroundExtra, fallback.selected),
  }
}

/** A space's theme from its semantic palette, Arc's own light and dark colours. */
export function arcTheme(customInfo: Json | undefined): SpaceTheme {
  const appearance = customInfo?.windowTheme?.semanticColorPalette?.appearanceBased
  return { light: palette(appearance?.light, DEFAULT_THEME.light), dark: palette(appearance?.dark, DEFAULT_THEME.dark) }
}

function tabIcon(tab: Json): string | undefined {
  const icon = tab?.customInfo?.iconType
  return icon?.emoji_v2 ?? icon?.emoji ?? undefined
}

/** Arc's sidebar as this browser's state. Ids are Arc's, so a second import finds the same rows. */
export function importArcSidebar(storable: Json, now = Date.now()): { state: BrowserState, report: ArcImportReport } {
  const containers: Json[] = storable?.sidebar?.containers ?? []
  const root = containers.find(container => Array.isArray(container.spaces)) ?? {}
  const items = new Map<string, Json>()
  for (const [id, item] of pairs(root.items)) if (typeof id === 'string' && item) items.set(id, item)
  const report: ArcImportReport = { spaces: 0, pinned: 0, today: 0, favorites: 0, folders: 0, splits: 0, skipped: {} }
  const state: BrowserState = { spaces: [], items: {}, activeSpace: '', selected: {}, closed: [] }

  /** One of Arc's items, and everything under it, into `section` of `space`. */
  const bring = (id: string, section: Section, space: string | null, parent: string | null, order: string) => {
    const item = items.get(id)
    if (!item) return
    const data: Json = item.data ?? {}
    const created = typeof item.createdAt === 'number' ? Math.round((item.createdAt + 978_307_200) * 1000) : now
    const base = { id, section, space, parent, order, createdAt: created, lastActiveAt: created }
    if (data.tab) {
      const url = data.tab.savedURL
      if (typeof url !== 'string' || !url) return
      const lastActive = typeof data.tab.timeLastActiveAt === 'number' ? Math.round((data.tab.timeLastActiveAt + 978_307_200) * 1000) : created
      const title = item.title ?? data.tab.savedTitle
      const icon = tabIcon(data.tab)
      const tab: Item = { ...base, kind: 'tab', url, lastActiveAt: lastActive, ...(title ? { title } : {}), ...(icon ? { icon } : {}), ...(section !== 'today' ? { savedUrl: url } : {}) }
      state.items[id] = tab
      report[section === 'favorites' ? 'favorites' : section === 'pinned' ? 'pinned' : 'today']++
      return
    }
    if (data.list || data.splitView) {
      const kind = data.list ? 'folder' : 'split'
      state.items[id] = { ...base, kind, title: item.title ?? (kind === 'folder' ? 'Folder' : 'Split View') }
      report[kind === 'folder' ? 'folders' : 'splits']++
      const children: string[] = item.childrenIds ?? []
      keysBetween(null, null, children.length).forEach((key, index) => bring(children[index]!, section, space, id, key))
      return
    }
    const kind = Object.keys(data)[0] ?? 'unknown'
    report.skipped[kind] = (report.skipped[kind] ?? 0) + 1
  }

  /** A container's children, in Arc's order, as top-level rows. */
  const bringContainer = (containerId: unknown, section: Section, space: string | null) => {
    if (typeof containerId !== 'string') return
    const children: string[] = items.get(containerId)?.childrenIds ?? []
    keysBetween(null, null, children.length).forEach((key, index) => bring(children[index]!, section, space, null, key))
  }

  for (const [id, raw] of pairs(root.spaces)) {
    if (typeof id !== 'string' || !raw) continue
    const icon = raw.customInfo?.iconType?.icon ?? raw.customInfo?.iconType?.emoji_v2 ?? raw.customInfo?.iconType?.emoji
    const space: Space = { id, name: raw.title ?? `Space ${state.spaces.length + 1}`, profile: raw.profile?.custom?._0?.directoryBasename ?? 'default', theme: arcTheme(raw.customInfo), ...(icon ? { icon } : {}) }
    state.spaces.push(space)
    state.selected[id] = null
    report.spaces++
    const containersOf = new Map(pairs<string>(raw.containerIDs).map(([key, value]) => [key, value]))
    bringContainer(containersOf.get('pinned'), 'pinned', id)
    bringContainer(containersOf.get('unpinned'), 'today', id)
  }
  // Favorites: Arc keeps one set per profile; the default profile's become this browser's.
  const favorites = pairs<string>(root.topAppsContainerIDs).find(([key]) => (key as Json)?.default === true)?.[1]
  bringContainer(favorites, 'favorites', null)

  if (!state.spaces.length) {
    const fallback: Space = { id: 'imported', name: 'Space 1', profile: 'default', theme: DEFAULT_THEME }
    state.spaces.push(fallback)
    state.selected[fallback.id] = null
  }
  const firstSpace = (storable?.sidebarSyncState?.container?.value?.orderedSpaceIDs ?? []).find((id: unknown) => state.spaces.some(space => space.id === id))
  state.activeSpace = firstSpace ?? state.spaces[0]!.id
  return { state, report }
}

/** Chromium's timestamps (Arc's History database) are microseconds since 1601. */
export function chromiumTime(microseconds: number): number {
  return Math.round(microseconds / 1000 - 11_644_473_600_000)
}

/**
 * An import added to the sidebar there is. A sidebar with nothing in it yet is
 * replaced outright; otherwise Arc's spaces come after the existing ones and
 * its favorites after the existing favorites. Rows already present (a second
 * import: Arc's ids are kept) are left as they are.
 */
export function mergeImported(current: BrowserState, imported: BrowserState): BrowserState {
  if (!Object.keys(current.items).length) return imported
  const spaces = [...current.spaces, ...imported.spaces.filter(space => !current.spaces.some(each => each.id === space.id))]
  const items = { ...current.items }
  const lastFavorite = Object.values(current.items).filter(item => item.section === 'favorites' && !item.parent).map(item => item.order).sort().at(-1) ?? null
  const newFavorites = Object.values(imported.items).filter(item => item.section === 'favorites' && !item.parent && !items[item.id]).sort((a, b) => (a.order < b.order ? -1 : 1))
  const favoriteKeys = keysBetween(lastFavorite, null, newFavorites.length)
  newFavorites.forEach((item, index) => { items[item.id] = { ...item, order: favoriteKeys[index]! } })
  for (const item of Object.values(imported.items)) if (!items[item.id]) items[item.id] = item
  const selected = { ...Object.fromEntries(spaces.map(space => [space.id, null])), ...current.selected }
  return { ...current, spaces, items, selected }
}
