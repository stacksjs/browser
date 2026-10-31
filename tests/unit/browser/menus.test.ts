import { describe, expect, it } from 'bun:test'
import { rowMenu, runRowAction } from '../../../resources/functions/browser/menus'
import type { BrowserState } from '../../../resources/functions/browser/sidebar'
import { addFavorite, createFolder, createState, moveItem, openTab, pinTab, renameItem, rows, splitOf, splitTabs, ungroupFolder, updateItem } from '../../../resources/functions/browser/sidebar'

function sample(): BrowserState {
  let state = createState({ id: 's' })
  for (const id of ['a', 'b', 'c']) state = openTab(state, { id, url: `https://${id}.com`, place: 'end', now: 1 }).state
  return state
}
const ids = (entries: Array<{ id?: string }>) => entries.flatMap(entry => (entry.id ? [entry.id] : []))

describe('row menus', () => {
  it('offer a Today tab split view with the tab on screen, pinning, favorites, and closing', () => {
    const state = sample()
    expect(ids(rowMenu(state, state.items.a!, 'b'))).toEqual(['split', 'pin', 'favorite', 'copy-link', 'rename', 'close'])
    expect(ids(rowMenu(state, state.items.b!, 'b'))).toEqual(['pin', 'favorite', 'copy-link', 'rename', 'close'])
  })

  it('know a pinned tab moved from its address, a favorite, a pane, a folder and a split view', () => {
    let state = pinTab(sample(), 'a')
    state = updateItem(state, 'a', { url: 'https://a.com/elsewhere' })
    expect(ids(rowMenu(state, state.items.a!, null))).toEqual(['unpin', 'favorite', 'new-folder', 'copy-link', 'rename', 'reset', 'close'])
    const favored = addFavorite(sample(), 'c')
    expect(ids(rowMenu(favored, favored.items.c!, 'a'))).toEqual(['unfavorite', 'copy-link', 'rename', 'close'])
    const split = splitTabs(sample(), 'a', 'b').state
    expect(ids(rowMenu(split, split.items.a!, 'b'))).toEqual(['leave-split', 'pin', 'favorite', 'copy-link', 'rename', 'close'])
    expect(ids(rowMenu(split, splitOf(split, 'a')!.split, 'b'))).toEqual(['separate', 'pin'])
    const folder = createFolder(sample(), { id: 'f' }).state
    expect(ids(rowMenu(folder, folder.items.f!, null))).toEqual(['rename', 'new-folder', 'ungroup'])
  })

  it('apply what was chosen, and hand back what only the window can do', () => {
    const state = sample()
    const paired = runRowAction(state, state.items.a!, 'split', 'c')
    expect(splitOf(paired.state, 'a')!.panes.map(pane => pane.id)).toEqual(['c', 'a'])
    const split = splitOf(paired.state, 'a')!.split
    const separated = runRowAction(paired.state, split, 'separate', 'a').state
    expect(separated.items[split.id]).toBeUndefined()
    expect(rows(separated, 'today').map(row => row.item.id)).toEqual(['b', 'c', 'a'])
    expect(runRowAction(state, state.items.a!, 'copy-link', null).effect).toEqual({ kind: 'copy', text: 'https://a.com' })
    expect(runRowAction(state, state.items.a!, 'close', null)).toEqual({ state, effect: { kind: 'close', id: 'a' } })
    const back = runRowAction(addFavorite(state, 'b'), addFavorite(state, 'b').items.b!, 'unfavorite', null).state
    expect(rows(back, 'today')[0]!.item.id).toBe('b')
    const pinned = pinTab(state, 'a')
    const made = runRowAction(pinned, pinned.items.a!, 'new-folder', null)
    expect(made.effect?.kind).toBe('rename')
    expect(rows(made.state, 'pinned').map(row => row.item.kind)).toEqual(['tab', 'folder'])
  })
})

describe('names and folders', () => {
  it('rename a tab without losing its page title, and a folder\'s own title', () => {
    let state = renameItem(sample(), 'a', '  Inbox ')
    expect(state.items.a).toMatchObject({ name: 'Inbox' })
    state = updateItem(state, 'a', { title: 'Page title' })
    expect(state.items.a!.name).toBe('Inbox')
    expect('name' in renameItem(state, 'a', '').items.a!).toBe(false)
    const folder = createFolder(state, { id: 'f' }).state
    expect(renameItem(folder, 'f', 'Work').items.f!.title).toBe('Work')
    expect(renameItem(folder, 'f', '  ')).toBe(folder)
  })

  it('ungroup a folder into its place, keeping its tabs in order', () => {
    let state = pinTab(pinTab(pinTab(sample(), 'a'), 'b'), 'c')
    state = createFolder(state, { id: 'f', place: { after: 'a' } }).state
    state = moveItem(state, 'b', { inside: 'f' })
    state = moveItem(state, 'c', { inside: 'f' })
    expect(rows(state, 'pinned').map(row => `${row.item.id}:${row.depth}`)).toEqual(['a:0', 'f:0', 'b:1', 'c:1'])
    const flat = ungroupFolder(state, 'f')
    expect(rows(flat, 'pinned').map(row => `${row.item.id}:${row.depth}`)).toEqual(['a:0', 'b:0', 'c:0'])
  })
})

describe('space menus', () => {
  it('rename, change the icon and colours, add and delete spaces', async () => {
    const { addSpace, runSpaceAction, spaceMenu } = await import('../../../resources/functions/browser/menus')
    let state = sample()
    expect(spaceMenu(state, 's').find(entry => entry.id === 'delete-space')!.disabled).toBe(true)
    const added = addSpace(state)
    state = added.state
    expect(state.spaces).toHaveLength(2)
    expect(state.activeSpace).toBe(state.spaces[1]!.id)
    expect(added.effect).toEqual({ kind: 'rename-space', id: state.spaces[1]!.id })
    expect(state.spaces[1]!.theme.colors).toEqual(['#5aa9e6', '#3d6ee0'])
    const second = state.spaces[1]!.id
    expect(spaceMenu(state, second).find(entry => entry.id === 'theme:ocean')).toMatchObject({ checked: true })
    state = runSpaceAction(state, second, 'icon:💼').state
    state = runSpaceAction(state, second, 'theme:mint').state
    expect(state.spaces[1]).toMatchObject({ icon: '💼', theme: { colors: ['#5fd3a5'] } })
    expect(spaceMenu(state, second).find(entry => entry.id === 'icon:💼')).toMatchObject({ checked: true })
    const gone = runSpaceAction(state, 's', 'delete-space')
    expect(gone.state.spaces.map(space => space.id)).toEqual([second])
    expect(gone.effect).toEqual({ kind: 'released', tabs: ['a', 'b', 'c'] })
  })
})
