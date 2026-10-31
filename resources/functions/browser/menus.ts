/**
 * What right-clicking a sidebar row offers. Each entry's `id` comes back from
 * `craft.desktop.contextMenu`, and `runRowAction` turns it into a new state;
 * actions that need the window (copying, renaming, closing a page) come back
 * as an `effect` for the screen to carry out.
 */

import type { BrowserState, Item } from './sidebar'
import { addFavorite, createFolder, createSpace, deleteSpace, leaveSplit, moveItem, pinTab, resetTab, splitOf, splitTabs, switchSpace, ungroupFolder, unpinTab, updateSpace } from './sidebar'
import { nextPreset, THEME_PRESETS, themeFromColors } from './theme'

export interface MenuEntry { id?: string, title?: string, icon?: string, separator?: boolean, disabled?: boolean }

export type RowAction =
  | 'split' | 'leave-split' | 'separate' | 'pin' | 'unpin' | 'favorite' | 'unfavorite'
  | 'copy-link' | 'reset' | 'rename' | 'new-folder' | 'ungroup' | 'close'

const SEP: MenuEntry = { separator: true }

/** The menu for `item`, given the tab on screen now (what "Open in Split View" pairs it with). */
export function rowMenu(state: BrowserState, item: Item, shownId: string | null): MenuEntry[] {
  if (item.kind === 'folder') {
    return [
      { id: 'rename', title: 'Rename Folder…', icon: 'pencil' },
      { id: 'new-folder', title: 'New Folder', icon: 'folder.badge.plus' },
      SEP,
      { id: 'ungroup', title: 'Ungroup Folder', icon: 'folder.badge.minus' },
    ]
  }
  if (item.kind === 'split') {
    return [
      { id: 'separate', title: 'Separate Tabs', icon: 'rectangle.split.2x1.slash' },
      ...(item.section === 'today' ? [{ id: 'pin', title: 'Pin Split View', icon: 'pin' }] : [{ id: 'unpin', title: 'Unpin Split View', icon: 'pin.slash' }]),
    ]
  }
  const shown = shownId ? state.items[shownId] : undefined
  const inSplit = splitOf(state, item.id)
  const canPair = shown && shown.id !== item.id && shown.kind === 'tab' && shown.section !== 'favorites' && item.section !== 'favorites'
    && !(inSplit && splitOf(state, shown.id)?.split.id === inSplit.split.id)
  const entries: MenuEntry[] = []
  if (canPair) entries.push({ id: 'split', title: 'Open in Split View', icon: 'rectangle.split.2x1' })
  if (inSplit) entries.push({ id: 'leave-split', title: 'Remove from Split View', icon: 'rectangle' })
  if (entries.length) entries.push(SEP)
  if (item.section === 'favorites') entries.push({ id: 'unfavorite', title: 'Remove from Favorites', icon: 'star.slash' })
  else {
    entries.push(item.section === 'today' ? { id: 'pin', title: 'Pin Tab', icon: 'pin' } : { id: 'unpin', title: 'Unpin Tab', icon: 'pin.slash' })
    entries.push({ id: 'favorite', title: 'Add to Favorites', icon: 'star' })
  }
  if (item.section === 'pinned') entries.push({ id: 'new-folder', title: 'New Folder', icon: 'folder.badge.plus' })
  entries.push(SEP, { id: 'copy-link', title: 'Copy Link', icon: 'link', disabled: !item.url }, { id: 'rename', title: 'Rename…', icon: 'pencil' })
  if (item.savedUrl && item.url !== item.savedUrl) entries.push({ id: 'reset', title: 'Back to Pinned Address', icon: 'arrow.uturn.backward' })
  entries.push(SEP, { id: 'close', title: item.section === 'today' ? 'Close Tab' : 'Unload Tab', icon: 'xmark' })
  return entries
}

export type RowEffect = { kind: 'copy', text: string } | { kind: 'rename', id: string } | { kind: 'close', id: string } | null

/** A chosen menu entry applied: the new state, and anything only the window can do. */
export function runRowAction(state: BrowserState, item: Item, action: string, shownId: string | null): { state: BrowserState, effect: RowEffect } {
  const same = (effect: RowEffect) => ({ state, effect })
  switch (action as RowAction) {
    case 'split': return shownId ? { state: splitTabs(state, shownId, item.id).state, effect: null } : same(null)
    case 'leave-split': return { state: leaveSplit(state, item.id), effect: null }
    case 'separate': {
      // Each pane after the first moves out below the split, last first; when one is
      // left the split becomes that tab, so they end up in their old order.
      const first = Object.values(state.items).find(pane => pane.parent === item.id)
      const panes = first ? splitOf(state, first.id)!.panes : []
      let next = state
      for (const pane of panes.slice(1).reverse()) next = moveItem(next, pane.id, { after: item.id })
      return { state: next, effect: null }
    }
    case 'pin': return { state: pinTab(state, item.id), effect: null }
    case 'unpin': return { state: unpinTab(state, item.id), effect: null }
    case 'favorite': return { state: addFavorite(state, item.id), effect: null }
    // Out of Favorites lands at the top of Today, as Arc does.
    case 'unfavorite': return { state: unpinTab(state, item.id), effect: null }
    case 'reset': return { state: resetTab(state, item.id), effect: null }
    case 'new-folder': {
      const { state: next, folder } = createFolder(state, item.section === 'pinned' && item.kind !== 'folder' ? { place: { after: item.id } } : item.kind === 'folder' ? { place: { inside: item.id } } : {})
      return { state: next, effect: { kind: 'rename', id: folder.id } }
    }
    case 'ungroup': return { state: ungroupFolder(state, item.id), effect: null }
    case 'copy-link': return same(item.url ? { kind: 'copy', text: item.url } : null)
    case 'rename': return same({ kind: 'rename', id: item.id })
    case 'close': return same({ kind: 'close', id: item.id })
    default: return same(null)
  }
}

/** Emoji a space can wear, offered in its menu. */
export const SPACE_ICONS = ['🏠', '💼', '🎨', '📚', '🧪', '🎮', '✈️', '💡', '🌱', '⭐️']

/** Right-clicking a space: rename, its icon, its colours, a new one, or deleting it. */
export function spaceMenu(state: BrowserState, spaceId: string): MenuEntry[] {
  const space = state.spaces.find(each => each.id === spaceId)
  if (!space) return []
  const colors = (space.theme.colors ?? []).join(',')
  return [
    { id: 'rename-space', title: 'Rename Space…', icon: 'pencil' },
    SEP,
    ...SPACE_ICONS.map(icon => ({ id: `icon:${icon}`, title: `${icon}  Icon`, ...(space.icon === icon ? { checked: true } : {}) })),
    SEP,
    ...THEME_PRESETS.map(preset => ({ id: `theme:${preset.id}`, title: `${preset.title} Theme`, icon: 'paintpalette', ...(colors === preset.colors.join(',') ? { checked: true } : {}) })),
    SEP,
    ...profiles(state).map(profile => ({ id: `profile:${profile}`, title: `${profileName(profile)} Profile`, icon: 'person.crop.circle', ...(space.profile === profile ? { checked: true } : {}) })),
    ...(state.spaces.some(each => each.id !== space.id && each.profile === space.profile) ? [{ id: 'own-profile', title: 'Give This Space Its Own Profile', icon: 'person.badge.plus' }] : []),
    SEP,
    { id: 'new-space', title: 'New Space', icon: 'plus' },
    { id: 'delete-space', title: 'Delete Space', icon: 'trash', disabled: state.spaces.length <= 1 },
  ]
}

export type SpaceEffect = { kind: 'rename-space', id: string } | { kind: 'released', tabs: string[] } | null

/** A new space with the next preset's colours, made the active one; its name is then edited in place. */
export function addSpace(state: BrowserState): { state: BrowserState, effect: SpaceEffect } {
  const preset = nextPreset(state.spaces.length)
  const made = createSpace(state, { name: `Space ${state.spaces.length + 1}`, theme: themeFromColors(preset.colors)! })
  return { state: switchSpace(made.state, made.space.id), effect: { kind: 'rename-space', id: made.space.id } }
}

export function runSpaceAction(state: BrowserState, spaceId: string, action: string): { state: BrowserState, effect: SpaceEffect } {
  if (action === 'rename-space') return { state, effect: { kind: 'rename-space', id: spaceId } }
  if (action === 'new-space') return addSpace(state)
  if (action === 'delete-space') {
    // Its tabs' pages go with it.
    return { state: deleteSpace(state, spaceId), effect: { kind: 'released', tabs: tabsOf(state, spaceId) } }
  }
  // A profile is a set of cookies and storage: a space on its own profile is signed in on its own.
  if (action.startsWith('profile:')) return { state: updateSpace(state, spaceId, { profile: action.slice(8) }), effect: { kind: 'released', tabs: tabsOf(state, spaceId) } }
  if (action === 'own-profile') {
    const space = state.spaces.find(each => each.id === spaceId)
    const taken = new Set(profiles(state))
    let name = (space?.name ?? 'space').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'space'
    for (let n = 2; taken.has(name); n++) name = `${name.replace(/-\d+$/, '')}-${n}`
    return { state: updateSpace(state, spaceId, { profile: name }), effect: { kind: 'released', tabs: tabsOf(state, spaceId) } }
  }
  if (action.startsWith('icon:')) return { state: updateSpace(state, spaceId, { icon: action.slice(5) }), effect: null }
  if (action.startsWith('theme:')) {
    const preset = THEME_PRESETS.find(each => each.id === action.slice(6))
    return { state: preset ? updateSpace(state, spaceId, { theme: themeFromColors(preset.colors)! }) : state, effect: null }
  }
  return { state, effect: null }
}

/** Every profile some space uses, the default first. */
export function profiles(state: BrowserState): string[] {
  return [...new Set(['default', ...state.spaces.map(space => space.profile)])]
}

export const profileName = (profile: string): string => (profile === 'default' ? 'Default' : profile.split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' '))

/** A space's tabs: their pages go when the space changes profile or is deleted. */
const tabsOf = (state: BrowserState, spaceId: string) => Object.values(state.items).filter(item => item.space === spaceId && item.kind === 'tab').map(item => item.id)
