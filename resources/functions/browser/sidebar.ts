/**
 * The sidebar as Arc arranges it: Favorites shared by every space, and in each
 * space its Pinned tabs and folders above the line and Today's tabs below it.
 *
 * Every function takes the state and returns a new one; nothing is mutated, so
 * a screen keeps the state in one signal and persistence can diff two of them.
 */

import { keyBetween } from './order'

export type Section = 'favorites' | 'pinned' | 'today'
export type ItemKind = 'tab' | 'folder' | 'split'

/** One appearance's colours for a space, as `#rrggbb` or `#rrggbbaa`. */
export interface Palette {
  /** The window behind the sidebar and the content card. */
  background: string
  /** A second stop for the background's gradient, when it has one. */
  backgroundTo?: string
  /** Text and icons in the sidebar. */
  foreground: string
  /** A hovered row. */
  hover: string
  /** The selected row. */
  selected: string
}

export interface SpaceTheme { light: Palette, dark: Palette }

export interface Space {
  id: string
  name: string
  /** An emoji or an SF Symbol name. */
  icon?: string
  /** Whose cookies and storage its tabs use. */
  profile: string
  theme: SpaceTheme
}

export interface Item {
  id: string
  kind: ItemKind
  section: Section
  /** The space it belongs to; Favorites belong to none, since every space shows them. */
  space: string | null
  /** The folder or split view holding it. */
  parent: string | null
  /** Sorts it among its siblings (see order.ts). */
  order: string
  title?: string
  url?: string
  /** Where a pinned tab or a favorite returns to when it is reset. */
  savedUrl?: string
  icon?: string
  /** A folder showing only its own row. */
  collapsed?: boolean
  createdAt: number
  lastActiveAt: number
}

export interface BrowserState {
  spaces: Space[]
  items: Record<string, Item>
  activeSpace: string
  /** The tab each space last showed. */
  selected: Record<string, string | null>
  /** Tabs closed most recently last, for reopening. */
  closed: Item[]
}

/** A row of the sidebar: an item and how deep it sits. A split view's tabs travel with its row. */
export interface Row { item: Item, depth: number, panes?: Item[] }

export const CLOSED_LIMIT = 50

let sequence = 0
/** An id unique to this run and across runs: a time, a counter and some randomness. */
export function newId(): string {
  sequence = (sequence + 1) % 1_679_616
  return `${Date.now().toString(36)}${sequence.toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 6)}`
}

export const DEFAULT_THEME: SpaceTheme = {
  light: { background: '#c9cffd', backgroundTo: '#aab4fb', foreground: '#1b1d3a', hover: '#ffffff66', selected: '#ffffffcc' },
  dark: { background: '#26285a', backgroundTo: '#1a1c45', foreground: '#eef0ff', hover: '#ffffff1a', selected: '#ffffff2e' },
}

export function createState(space: Partial<Space> = {}): BrowserState {
  const first: Space = { id: space.id ?? newId(), name: space.name ?? 'Space 1', profile: space.profile ?? 'default', theme: space.theme ?? DEFAULT_THEME, ...(space.icon ? { icon: space.icon } : {}) }
  return { spaces: [first], items: {}, activeSpace: first.id, selected: { [first.id]: null }, closed: [] }
}

// Reading

/** The items directly inside a list: a section of a space, or a folder or split view. */
export function childrenOf(state: BrowserState, where: { section: Section, space: string | null, parent?: string | null }): Item[] {
  const parent = where.parent ?? null
  const space = where.section === 'favorites' ? null : where.space
  return Object.values(state.items)
    .filter(item => item.section === where.section && item.space === space && item.parent === parent)
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
}

/** A section as the sidebar draws it: folders open unless collapsed, split views as one row. */
export function rows(state: BrowserState, section: Section, space: string | null = state.activeSpace): Row[] {
  const out: Row[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const item of childrenOf(state, { section, space, parent })) {
      if (item.kind === 'split') { out.push({ item, depth, panes: childrenOf(state, { section, space, parent: item.id }) }); continue }
      out.push({ item, depth })
      if (item.kind === 'folder' && !item.collapsed) walk(item.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** The tab a space shows now, if any. */
export function selectedTab(state: BrowserState, space: string = state.activeSpace): Item | null {
  const id = state.selected[space]
  return id ? state.items[id] ?? null : null
}

/** Every tab of a space in sidebar order, favorites first: what ctrl-tab cycles through. */
export function tabOrder(state: BrowserState, space: string = state.activeSpace): Item[] {
  const tabs = (section: Section) => rows(state, section, space).flatMap(row => row.panes ?? (row.item.kind === 'tab' ? [row.item] : []))
  return [...tabs('favorites'), ...tabs('pinned'), ...tabs('today')]
}

// Changing

type Place = 'start' | 'end' | { before: string } | { after: string } | { inside: string }

function update(state: BrowserState, changes: Record<string, Item | null>, extra: Partial<BrowserState> = {}): BrowserState {
  const items = { ...state.items }
  for (const [id, item] of Object.entries(changes)) {
    if (item) items[id] = item
    else delete items[id]
  }
  return { ...state, ...extra, items }
}

/** Where a new or moved item lands: its list and its order key there. */
function resolvePlace(state: BrowserState, place: Place, list: { section: Section, space: string | null, parent: string | null }, moving?: string) {
  if (place === 'start' || place === 'end') {
    const siblings = childrenOf(state, list).filter(item => item.id !== moving)
    const order = place === 'start' ? keyBetween(null, siblings[0]?.order ?? null) : keyBetween(siblings.at(-1)?.order ?? null, null)
    return { ...list, order }
  }
  if ('inside' in place) {
    const folder = state.items[place.inside]
    if (!folder || folder.kind === 'tab') throw new Error(`Only a folder or split view holds items: ${place.inside}`)
    return resolvePlace(state, 'end', { section: folder.section, space: folder.space, parent: folder.id }, moving)
  }
  const anchorId = 'before' in place ? place.before : place.after
  const anchor = state.items[anchorId]
  if (!anchor) throw new Error(`No item ${anchorId}`)
  const at = { section: anchor.section, space: anchor.space, parent: anchor.parent }
  const siblings = childrenOf(state, at).filter(item => item.id !== moving)
  const index = siblings.findIndex(item => item.id === anchorId)
  const order = 'before' in place
    ? keyBetween(siblings[index - 1]?.order ?? null, anchor.order)
    : keyBetween(anchor.order, siblings[index + 1]?.order ?? null)
  return { ...at, order }
}

export interface OpenOptions {
  url: string
  title?: string
  space?: string
  section?: Section
  /** Today's new tabs go first, as Arc adds them; anywhere else they go last. */
  place?: Place
  /** Opened behind the current tab (a cmd-click) rather than shown. */
  background?: boolean
  id?: string
  now?: number
}

/** A new tab, shown unless `background`. */
export function openTab(state: BrowserState, options: OpenOptions): { state: BrowserState, tab: Item } {
  const now = options.now ?? Date.now()
  const section = options.section ?? 'today'
  const space = options.space ?? state.activeSpace
  const place = resolvePlace(state, options.place ?? (section === 'today' ? 'start' : 'end'), { section, space: section === 'favorites' ? null : space, parent: null })
  const tab: Item = {
    id: options.id ?? newId(), kind: 'tab', ...place, url: options.url, createdAt: now, lastActiveAt: now,
    ...(options.title ? { title: options.title } : {}),
    ...(section !== 'today' ? { savedUrl: options.url } : {}),
  }
  let next = update(state, { [tab.id]: tab })
  if (!options.background) next = selectTab(next, tab.id, now)
  return { state: next, tab }
}

/** Show a tab: its space becomes the active one (a favorite stays in the current space). */
export function selectTab(state: BrowserState, id: string, now = Date.now()): BrowserState {
  const item = state.items[id]
  if (!item || item.kind === 'folder') return state
  const space = item.space ?? state.activeSpace
  return update(state, { [id]: { ...item, lastActiveAt: now } }, { activeSpace: space, selected: { ...state.selected, [space]: id } })
}

/** What to show when `id` goes: the next tab down its list, else the one above, else none. */
function neighbour(state: BrowserState, id: string): string | null {
  const item = state.items[id]
  if (!item) return null
  const list = rows(state, item.section, item.space ?? state.activeSpace).flatMap(row => row.panes ?? [row.item]).filter(row => row.kind === 'tab')
  const index = list.findIndex(tab => tab.id === id)
  return list[index + 1]?.id ?? list[index - 1]?.id ?? null
}

/**
 * Closing a Today tab removes it (reopenable); closing a pinned tab or a
 * favorite only unloads it: its row stays, and it comes back at its saved address.
 */
export function closeTab(state: BrowserState, id: string): { state: BrowserState, removed: boolean } {
  const item = state.items[id]
  if (!item || item.kind !== 'tab') return { state, removed: false }
  const space = item.space ?? state.activeSpace
  const selected = state.selected[space] === id ? { ...state.selected, [space]: neighbour(state, id) } : state.selected
  if (item.section !== 'today') return { state: { ...state, selected }, removed: false }
  const closed = [...state.closed, item].slice(-CLOSED_LIMIT)
  return { state: update(state, { [id]: null }, { selected, closed }), removed: true }
}

/** The most recently closed tab, back where it was if its list still exists, else first in Today. */
export function reopenClosed(state: BrowserState, now = Date.now()): { state: BrowserState, tab: Item | null } {
  const tab = state.closed.at(-1)
  if (!tab) return { state, tab: null }
  const closed = state.closed.slice(0, -1)
  const parentGone = tab.parent !== null && !state.items[tab.parent]
  const spaceGone = tab.space !== null && !state.spaces.some(space => space.id === tab.space)
  const taken = Object.values(state.items).some(item => item.order === tab.order && item.parent === tab.parent && item.section === tab.section && item.space === tab.space)
  let restored: Item = { ...tab, lastActiveAt: now }
  if (parentGone || spaceGone || taken) {
    const space = spaceGone ? state.activeSpace : tab.space
    restored = { ...restored, ...resolvePlace(state, 'start', { section: 'today', space, parent: null }) }
  }
  return { state: selectTab(update(state, { [tab.id]: restored }, { closed }), tab.id, now), tab: restored }
}

/** Is `id` the item `ancestor`, or inside it? */
function within(state: BrowserState, id: string | null, ancestor: string): boolean {
  for (let current = id; current; current = state.items[current]?.parent ?? null)
    if (current === ancestor) return true
  return false
}

/**
 * A drag's drop: before or after another row, or inside a folder. Crossing the
 * line pins or unpins, as in Arc: a tab gains a saved address on the way up and
 * loses it on the way down. Favorites hold tabs only.
 */
export function moveItem(state: BrowserState, id: string, place: Place): BrowserState {
  const item = state.items[id]
  if (!item) return state
  const target = typeof place === 'object' ? ('before' in place ? place.before : 'after' in place ? place.after : place.inside) : null
  if (target && within(state, target, id)) return state
  const list = typeof place === 'string' ? { section: item.section, space: item.space, parent: item.parent } : undefined
  const landing = resolvePlace(state, place, list ?? { section: item.section, space: item.space, parent: null }, id)
  if (landing.section === 'favorites' && item.kind !== 'tab') return state
  const moved: Item = { ...item, ...landing }
  if (landing.section !== 'today' && item.section === 'today' && moved.kind === 'tab') moved.savedUrl = moved.url
  if (landing.section === 'today') delete moved.savedUrl
  // A folder carries what is inside it into its new list.
  const changes: Record<string, Item | null> = { [id]: moved }
  if (item.kind !== 'tab' && (landing.section !== item.section || landing.space !== item.space)) {
    for (const child of Object.values(state.items)) {
      if (child.id !== id && within(state, child.id, id)) changes[child.id] = { ...child, section: landing.section, space: landing.space }
    }
  }
  return update(state, changes)
}

export const pinTab = (state: BrowserState, id: string): BrowserState => {
  const item = state.items[id]
  if (!item) return state
  return moveToList(state, id, { section: 'pinned', space: item.space ?? state.activeSpace }, 'end')
}
export const unpinTab = (state: BrowserState, id: string): BrowserState => {
  const item = state.items[id]
  if (!item) return state
  return moveToList(state, id, { section: 'today', space: item.space ?? state.activeSpace }, 'start')
}
export const addFavorite = (state: BrowserState, id: string): BrowserState => moveToList(state, id, { section: 'favorites', space: null }, 'end')

function moveToList(state: BrowserState, id: string, list: { section: Section, space: string | null }, at: 'start' | 'end'): BrowserState {
  const item = state.items[id]
  if (!item) return state
  const siblings = childrenOf(state, { ...list, parent: null }).filter(other => other.id !== id)
  if (!siblings.length) {
    const moved: Item = { ...item, section: list.section, space: list.section === 'favorites' ? null : list.space, parent: null, order: keyBetween(null, null) }
    if (list.section !== 'today' && item.section === 'today') moved.savedUrl = item.url
    if (list.section === 'today') delete moved.savedUrl
    return update(state, { [id]: moved })
  }
  return moveItem(state, id, at === 'start' ? { before: siblings[0]!.id } : { after: siblings.at(-1)!.id })
}

export function createFolder(state: BrowserState, options: { title?: string, space?: string, place?: Place, now?: number, id?: string } = {}): { state: BrowserState, folder: Item } {
  const now = options.now ?? Date.now()
  const space = options.space ?? state.activeSpace
  const landing = resolvePlace(state, options.place ?? 'end', { section: 'pinned', space, parent: null })
  const folder: Item = { id: options.id ?? newId(), kind: 'folder', ...landing, title: options.title ?? 'New Folder', createdAt: now, lastActiveAt: now }
  return { state: update(state, { [folder.id]: folder }), folder }
}

/** A row's own fields: a tab's title, address and icon as its page reports them, a folder's name, a folder opening. */
export function updateItem(state: BrowserState, id: string, fields: Partial<Pick<Item, 'title' | 'url' | 'icon' | 'collapsed'>>): BrowserState {
  const item = state.items[id]
  if (!item) return state
  const changed = (Object.keys(fields) as Array<keyof typeof fields>).some(key => item[key] !== fields[key])
  return changed ? update(state, { [id]: { ...item, ...fields } }) : state
}

/** A pinned tab or favorite back at its saved address. */
export function resetTab(state: BrowserState, id: string): BrowserState {
  const item = state.items[id]
  return item?.savedUrl ? updateItem(state, id, { url: item.savedUrl }) : state
}

/** Arc's Clear: every Today tab of a space goes to the archive. */
export function clearToday(state: BrowserState, space: string = state.activeSpace): { state: BrowserState, archived: Item[] } {
  const archived = Object.values(state.items).filter(item => item.section === 'today' && item.space === space && item.kind === 'tab')
  return archive(state, archived)
}

/** Today tabs left alone longer than `idleMs` go to the archive; the one on screen never does. */
export function autoArchive(state: BrowserState, now: number, idleMs: number): { state: BrowserState, archived: Item[] } {
  const showing = new Set(Object.values(state.selected).filter(Boolean))
  const stale = Object.values(state.items).filter(item => item.section === 'today' && item.kind === 'tab' && !showing.has(item.id) && now - item.lastActiveAt > idleMs)
  return archive(state, stale)
}

function archive(state: BrowserState, tabs: Item[]): { state: BrowserState, archived: Item[] } {
  if (!tabs.length) return { state, archived: [] }
  const gone = new Set(tabs.map(tab => tab.id))
  const selected = Object.fromEntries(Object.entries(state.selected).map(([space, id]) => [space, id && gone.has(id) ? null : id]))
  const changes = Object.fromEntries(tabs.map(tab => [tab.id, null]))
  return { state: update(state, changes, { selected }), archived: tabs }
}

// Spaces

export function createSpace(state: BrowserState, space: Partial<Space> & { name: string }): { state: BrowserState, space: Space } {
  const created: Space = { id: space.id ?? newId(), name: space.name, profile: space.profile ?? 'default', theme: space.theme ?? DEFAULT_THEME, ...(space.icon ? { icon: space.icon } : {}) }
  return { state: { ...state, spaces: [...state.spaces, created], selected: { ...state.selected, [created.id]: null } }, space: created }
}

/** Another space, by id or as the next or previous one (wrapping, as a two-finger swipe does). */
export function switchSpace(state: BrowserState, to: string | 'next' | 'previous'): BrowserState {
  const index = state.spaces.findIndex(space => space.id === state.activeSpace)
  const count = state.spaces.length
  const id = to === 'next' ? state.spaces[(index + 1) % count]!.id : to === 'previous' ? state.spaces[(index - 1 + count) % count]!.id : to
  return state.spaces.some(space => space.id === id) ? { ...state, activeSpace: id } : state
}

export function updateSpace(state: BrowserState, id: string, fields: Partial<Omit<Space, 'id'>>): BrowserState {
  return { ...state, spaces: state.spaces.map(space => (space.id === id ? { ...space, ...fields } : space)) }
}

/** A space and everything in it. The last space stays. */
export function deleteSpace(state: BrowserState, id: string): BrowserState {
  if (state.spaces.length <= 1 || !state.spaces.some(space => space.id === id)) return state
  const spaces = state.spaces.filter(space => space.id !== id)
  const changes = Object.fromEntries(Object.values(state.items).filter(item => item.space === id).map(item => [item.id, null]))
  const selected = Object.fromEntries(Object.entries(state.selected).filter(([space]) => space !== id))
  return update(state, changes, { spaces, selected, activeSpace: state.activeSpace === id ? spaces[0]!.id : state.activeSpace })
}
