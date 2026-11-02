/**
 * What the command bar can do besides opening pages: each action is a menu
 * command (keymap.ts), found by its title or the words people reach for.
 */

import type { Candidate } from './rank'

export interface BrowserAction { command: string, title: string, keywords: string, symbol: string, needsTab?: boolean }

export const ACTIONS: BrowserAction[] = [
  { command: 'copy-url', title: 'Copy URL', keywords: 'link address share', symbol: 'link', needsTab: true },
  { command: 'pin-tab', title: 'Pin or Unpin Tab', keywords: 'keep', symbol: 'pin', needsTab: true },
  { command: 'split-view', title: 'Add Split View', keywords: 'side by side panes', symbol: 'rectangle.split.2x1' },
  { command: 'new-space', title: 'New Space', keywords: 'create workspace', symbol: 'plus.square.on.square' },
  { command: 'library', title: 'Open Library', keywords: 'archive closed tabs history', symbol: 'books.vertical' },
  { command: 'downloads', title: 'Show Downloads', keywords: 'files', symbol: 'arrow.down.circle' },
  { command: 'clear-today', title: 'Clear Today', keywords: 'archive close all tabs', symbol: 'archivebox' },
  { command: 'toggle-sidebar', title: 'Toggle Sidebar', keywords: 'hide show compact', symbol: 'sidebar.left' },
  { command: 'reopen-closed', title: 'Reopen Closed Tab', keywords: 'undo restore', symbol: 'arrow.uturn.backward' },
  { command: 'find', title: 'Find on Page', keywords: 'search text', symbol: 'text.magnifyingglass', needsTab: true },
  { command: 'print', title: 'Print Page', keywords: 'pdf paper', symbol: 'printer', needsTab: true },
  { command: 'view-source', title: 'View Source', keywords: 'html code developer', symbol: 'chevron.left.forwardslash.chevron.right', needsTab: true },
  { command: 'new-window', title: 'New Window', keywords: 'window', symbol: 'macwindow' },
  { command: 'new-private-window', title: 'New Private Window', keywords: 'incognito', symbol: 'eyeglasses' },
  { command: 'little-arc', title: 'New Little Window', keywords: 'mini quick', symbol: 'macwindow' },
  { command: 'site-controls', title: 'Site Controls', keywords: 'permissions cookies zoom blocker', symbol: 'slider.horizontal.3', needsTab: true },
  { command: 'settings', title: 'Settings', keywords: 'preferences options', symbol: 'gearshape' },
  { command: 'set-default-browser', title: 'Make Default Browser', keywords: 'default', symbol: 'checkmark.seal' },
]

/** Actions as command-bar candidates; those that act on a page only when one is on screen. */
export function actionCandidates(hasTab: boolean): Candidate[] {
  return ACTIONS.filter(action => hasTab || !action.needsTab)
    .map(action => ({ kind: 'action', id: action.command, title: action.title, keywords: action.keywords }))
}

export const actionSymbol = (command: string): string => ACTIONS.find(action => action.command === command)?.symbol ?? 'bolt'
