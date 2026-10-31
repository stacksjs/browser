/**
 * Arc's keyboard, as menus. Each command's id arrives through
 * `craft.desktop.onCommand`; the menu bar shows its shortcut, so the keys are
 * discoverable the Mac way.
 */

export interface MenuItem { id?: string, label?: string, shortcut?: string, separator?: boolean, disabled?: boolean }
export interface Menu { label: string, items: MenuItem[] }

export type Command =
  | 'new-tab' | 'new-window' | 'new-private-window' | 'little-arc' | 'reopen-closed' | 'close-tab' | 'open-location'
  | 'copy-url' | 'pin-tab' | 'split-view' | 'toggle-sidebar' | 'find' | 'find-next' | 'find-previous'
  | 'reload' | 'hard-reload' | 'back' | 'forward' | 'zoom-in' | 'zoom-out' | 'zoom-reset'
  | 'next-tab' | 'previous-tab' | 'next-space' | 'previous-space' | 'new-space' | 'library' | 'downloads'
  | 'clear-today' | 'developer-tools' | 'view-source' | `space-${number}` | `favorite-${number}`

const SEP: MenuItem = { separator: true }
const numbered = (prefix: 'space' | 'favorite', label: string, modifier: string): MenuItem[] =>
  Array.from({ length: 9 }, (_, index) => ({ id: `${prefix}-${index + 1}`, label: `${label} ${index + 1}`, shortcut: `${modifier}+${index + 1}` }))

/** File, Edit's find, View, Tabs and Spaces, between the app menu and Window. */
export function browserMenus(): Menu[] {
  return [
    { label: 'File', items: [
      { id: 'new-tab', label: 'New Tab', shortcut: 'cmd+t' },
      { id: 'new-window', label: 'New Window', shortcut: 'cmd+n' },
      { id: 'new-private-window', label: 'New Private Window', shortcut: 'cmd+shift+n' },
      { id: 'little-arc', label: 'New Little Window', shortcut: 'cmd+alt+n' },
      SEP,
      { id: 'open-location', label: 'Open Location…', shortcut: 'cmd+l' },
      { id: 'reopen-closed', label: 'Reopen Closed Tab', shortcut: 'cmd+shift+t' },
      { id: 'close-tab', label: 'Close Tab', shortcut: 'cmd+w' },
      SEP,
      { id: 'copy-url', label: 'Copy URL', shortcut: 'cmd+shift+c' },
    ] },
    { label: 'Find', items: [
      { id: 'find', label: 'Find…', shortcut: 'cmd+f' },
      { id: 'find-next', label: 'Find Next', shortcut: 'cmd+g' },
      { id: 'find-previous', label: 'Find Previous', shortcut: 'cmd+shift+g' },
    ] },
    { label: 'View', items: [
      { id: 'toggle-sidebar', label: 'Toggle Sidebar', shortcut: 'cmd+s' },
      { id: 'split-view', label: 'Add Split View', shortcut: 'cmd+shift+=' },
      SEP,
      { id: 'reload', label: 'Reload Page', shortcut: 'cmd+r' },
      { id: 'hard-reload', label: 'Reload Ignoring Cache', shortcut: 'cmd+shift+r' },
      SEP,
      { id: 'zoom-in', label: 'Zoom In', shortcut: 'cmd+=' },
      { id: 'zoom-out', label: 'Zoom Out', shortcut: 'cmd+-' },
      { id: 'zoom-reset', label: 'Actual Size', shortcut: 'cmd+0' },
      SEP,
      { id: 'developer-tools', label: 'Developer Tools', shortcut: 'cmd+alt+i' },
      { id: 'view-source', label: 'View Source', shortcut: 'cmd+alt+u' },
    ] },
    { label: 'Tabs', items: [
      { id: 'back', label: 'Back', shortcut: 'cmd+[' },
      { id: 'forward', label: 'Forward', shortcut: 'cmd+]' },
      SEP,
      { id: 'pin-tab', label: 'Pin Tab', shortcut: 'cmd+d' },
      { id: 'next-tab', label: 'Next Tab', shortcut: 'ctrl+tab' },
      { id: 'previous-tab', label: 'Previous Tab', shortcut: 'ctrl+shift+tab' },
      SEP,
      ...numbered('favorite', 'Favorite', 'cmd'),
      SEP,
      { id: 'clear-today', label: 'Clear Today', shortcut: 'cmd+shift+k' },
    ] },
    { label: 'Spaces', items: [
      { id: 'next-space', label: 'Next Space', shortcut: 'cmd+alt+right' },
      { id: 'previous-space', label: 'Previous Space', shortcut: 'cmd+alt+left' },
      { id: 'new-space', label: 'New Space…' },
      SEP,
      ...numbered('space', 'Space', 'ctrl'),
      SEP,
      { id: 'library', label: 'Library', shortcut: 'cmd+shift+l' },
      { id: 'downloads', label: 'Downloads', shortcut: 'cmd+shift+j' },
    ] },
  ]
}

/** Every command id the menus can send, to check a handler table covers them all. */
export function commandIds(menus: Menu[] = browserMenus()): string[] {
  return menus.flatMap(menu => menu.items.flatMap(item => (item.id ? [item.id] : [])))
}
