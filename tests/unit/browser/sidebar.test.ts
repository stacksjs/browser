import { describe, expect, it } from 'bun:test'
import { displayHost, displayTitle, resolveInput, samePage } from '../../../resources/functions/browser/address'
import { keyBetween, keysBetween } from '../../../resources/functions/browser/order'
import { addFavorite, autoArchive, clearToday, closeTab, createFolder, createSpace, createState, deleteSpace, leaveSplit, moveItem, openTab, pinTab, reopenClosed, resetTab, rows, selectedTab, selectTab, SPLIT_LIMIT, splitOf, splitTabs, switchSpace, tabOrder, unpinTab, updateItem } from '../../../resources/functions/browser/sidebar'

describe('order keys', () => {
  it('always find a key between two others, in order, however often a row moves', () => {
    let low: string | null = null
    let high: string | null = null
    const keys: string[] = []
    for (let i = 0; i < 200; i++) {
      const key = keyBetween(low, high)
      if (low !== null) expect(key > low).toBe(true)
      if (high !== null) expect(key < high).toBe(true)
      keys.push(key)
      if (i % 2) low = key
      else high = key
    }
    expect(new Set(keys).size).toBe(keys.length)
    expect(Math.max(...keys.map(key => key.length))).toBeLessThan(60)
  })

  it('stays short when rows only ever arrive at either end', () => {
    let last: string | null = null
    let first: string | null = null
    const appended: string[] = []
    const prepended: string[] = []
    for (let i = 0; i < 1000; i++) {
      last = keyBetween(last, null); appended.push(last)
      first = keyBetween(null, first); prepended.push(first)
    }
    expect([...appended].sort()).toEqual(appended)
    expect([...prepended].reverse()).toEqual([...prepended].sort())
    expect(last!.length).toBeLessThan(40)
    expect(first!.length).toBeLessThan(40)
    expect([...appended, ...prepended].every(key => !key.endsWith('0'))).toBe(true)
  })

  it('hands out several keys in order for an import', () => {
    const keys = keysBetween(null, null, 50)
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(50)
  })

  it('refuses keys out of order', () => {
    expect(() => keyBetween('b', 'a')).toThrow()
  })
})

describe('the address bar', () => {
  it('opens what looks like an address and searches the rest', () => {
    expect(resolveInput('stacksjs.com')).toEqual({ kind: 'url', url: 'https://stacksjs.com' })
    expect(resolveInput('stacksjs.com/docs?x=1')).toEqual({ kind: 'url', url: 'https://stacksjs.com/docs?x=1' })
    expect(resolveInput('localhost:3000')).toEqual({ kind: 'url', url: 'http://localhost:3000' })
    expect(resolveInput('127.0.0.1:8080/api')).toEqual({ kind: 'url', url: 'http://127.0.0.1:8080/api' })
    expect(resolveInput('https://example.com')).toEqual({ kind: 'url', url: 'https://example.com' })
    expect(resolveInput('mailto:hi@example.com')).toEqual({ kind: 'url', url: 'mailto:hi@example.com' })
    expect(resolveInput('stacksjs.com:8080')).toEqual({ kind: 'url', url: 'https://stacksjs.com:8080' })
    expect(resolveInput('how do arc spaces work', 'duckduckgo')).toEqual({ kind: 'search', query: 'how do arc spaces work', url: 'https://duckduckgo.com/?q=how%20do%20arc%20spaces%20work' })
    expect(resolveInput('typescript')?.kind).toBe('search')
    expect(resolveInput('node.js tutorial')?.kind).toBe('search')
    expect(resolveInput('   ')).toBeNull()
  })

  it('reads an address the way the pill shows it', () => {
    expect(displayHost('https://www.stacksjs.com/docs/x')).toBe('stacksjs.com')
    expect(displayHost('about:blank')).toBe('about')
    expect(displayTitle('', 'https://github.com/stacksjs')).toBe('github.com')
    expect(displayTitle(undefined, undefined)).toBe('New Tab')
    expect(samePage('https://a.b/c/', 'https://a.b/c#top')).toBe(true)
  })
})

describe('the sidebar', () => {
  const at = (n: number) => 1_000_000 + n

  it('opens Today tabs at the top and shows them, or keeps them behind with background', () => {
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://a.com', id: 'a', now: at(1) }).state
    state = openTab(state, { url: 'https://b.com', id: 'b', now: at(2) }).state
    state = openTab(state, { url: 'https://c.com', id: 'c', background: true, now: at(3) }).state
    expect(rows(state, 'today').map(row => row.item.id)).toEqual(['c', 'b', 'a'])
    expect(selectedTab(state)?.id).toBe('b')
  })

  it('closes a Today tab to its neighbour below, else above, and reopens it in place', () => {
    let state = createState({ id: 's1' })
    for (const id of ['a', 'b', 'c']) state = openTab(state, { url: `https://${id}.com`, id, now: at(1) }).state
    // Today reads c, b, a.
    state = selectTab(state, 'b', at(2))
    state = closeTab(state, 'b').state
    expect(selectedTab(state)?.id).toBe('a')
    state = closeTab(state, 'a').state
    expect(selectedTab(state)?.id).toBe('c')
    const back = reopenClosed(state, at(3))
    expect(back.tab?.id).toBe('a')
    expect(rows(back.state, 'today').map(row => row.item.id)).toEqual(['c', 'a'])
    expect(selectedTab(back.state)?.id).toBe('a')
    expect(back.state.closed.map(tab => tab.id)).toEqual(['b'])
  })

  it('unloads a pinned tab instead of removing it, and resets it to its saved address', () => {
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://mail.com', id: 'mail', section: 'pinned', now: at(1) }).state
    state = updateItem(state, 'mail', { url: 'https://mail.com/inbox/42', title: 'Inbox' })
    const closed = closeTab(state, 'mail')
    expect(closed.removed).toBe(false)
    expect(closed.state.items.mail).toBeTruthy()
    expect(selectedTab(closed.state)).toBeNull()
    expect(resetTab(closed.state, 'mail').items.mail!.url).toBe('https://mail.com')
  })

  it('pins across the line and unpins back, keeping or dropping the saved address', () => {
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://docs.com', id: 'docs', now: at(1) }).state
    state = pinTab(state, 'docs')
    expect(state.items.docs).toMatchObject({ section: 'pinned', savedUrl: 'https://docs.com' })
    state = unpinTab(state, 'docs')
    expect(state.items.docs!.section).toBe('today')
    expect(state.items.docs!.savedUrl).toBeUndefined()
  })

  it('drops rows before, after and inside folders, carrying a folder\'s tabs with it', () => {
    let state = createState({ id: 's1' })
    state = createFolder(state, { title: 'Work', id: 'work', now: at(1) }).state
    for (const id of ['x', 'y', 'z']) state = openTab(state, { url: `https://${id}.com`, id, section: 'pinned', now: at(1) }).state
    state = moveItem(state, 'y', { inside: 'work' })
    state = moveItem(state, 'z', { before: 'work' })
    expect(rows(state, 'pinned').map(row => `${row.item.id}:${row.depth}`)).toEqual(['z:0', 'work:0', 'y:1', 'x:0'])
    // A folder cannot go inside itself.
    expect(moveItem(state, 'work', { inside: 'work' })).toBe(state)
    state = updateItem(state, 'work', { collapsed: true })
    expect(rows(state, 'pinned').map(row => row.item.id)).toEqual(['z', 'work', 'x'])
    // Moving the folder into Today's list moves its tab with it.
    state = openTab(state, { url: 'https://t.com', id: 't', now: at(2) }).state
    state = moveItem(state, 'work', { after: 't' })
    expect(state.items.y!.section).toBe('today')
  })

  it('shares favorites across spaces, keeps a favorite in the current space, and holds tabs only', () => {
    let state = createState({ id: 's1' })
    state = createSpace(state, { name: 'Work', id: 's2' }).state
    state = openTab(state, { url: 'https://cal.com', id: 'cal', now: at(1) }).state
    state = addFavorite(state, 'cal')
    expect(state.items.cal).toMatchObject({ section: 'favorites', space: null })
    state = switchSpace(state, 's2')
    expect(rows(state, 'favorites').map(row => row.item.id)).toEqual(['cal'])
    state = selectTab(state, 'cal', at(2))
    expect(state.activeSpace).toBe('s2')
    state = createFolder(state, { id: 'f', now: at(3) }).state
    expect(moveItem(state, 'f', { before: 'cal' })).toBe(state)
  })

  it('cycles tabs in sidebar order: favorites, pinned, then Today', () => {
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://t.com', id: 't', now: at(1) }).state
    state = openTab(state, { url: 'https://p.com', id: 'p', section: 'pinned', now: at(1) }).state
    state = openTab(state, { url: 'https://f.com', id: 'f', section: 'favorites', now: at(1) }).state
    expect(tabOrder(state).map(tab => tab.id)).toEqual(['f', 'p', 't'])
  })

  it('clears Today, and archives only tabs left alone long enough and not on screen', () => {
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://old.com', id: 'old', now: at(0) }).state
    state = openTab(state, { url: 'https://new.com', id: 'new', now: at(0) }).state
    state = openTab(state, { url: 'https://pin.com', id: 'pin', section: 'pinned', background: true, now: at(0) }).state
    const idle = autoArchive(state, at(0) + 13 * 3_600_000, 12 * 3_600_000)
    expect(idle.archived.map(tab => tab.id)).toEqual(['old'])
    const cleared = clearToday(state)
    expect(cleared.archived.map(tab => tab.id).sort()).toEqual(['new', 'old'])
    expect(selectedTab(cleared.state)).toBeNull()
    expect(cleared.state.items.pin).toBeTruthy()
  })

  it('switches spaces by swiping, wrapping round, and keeps the last space', () => {
    let state = createState({ id: 's1' })
    state = createSpace(state, { name: 'Two', id: 's2' }).state
    expect(switchSpace(state, 'next').activeSpace).toBe('s2')
    expect(switchSpace(state, 'previous').activeSpace).toBe('s2')
    state = openTab(switchSpace(state, 's2'), { url: 'https://x.com', id: 'x', now: at(1) }).state
    state = deleteSpace(state, 's2')
    expect(state.spaces.map(space => space.id)).toEqual(['s1'])
    expect(state.items.x).toBeUndefined()
    expect(state.activeSpace).toBe('s1')
    expect(deleteSpace(state, 's1')).toBe(state)
  })

  it('leaves the state alone when nothing changes', () => {
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://a.com', title: 'A', id: 'a', now: at(1) }).state
    expect(updateItem(state, 'a', { title: 'A' })).toBe(state)
    expect(closeTab(state, 'missing').state).toBe(state)
  })
})

describe('split view', () => {
  const at = (n: number) => 2_000_000 + n
  function three() {
    let state = createState({ id: 's1' })
    for (const id of ['a', 'b', 'c']) state = openTab(state, { url: `https://${id}.com`, id, place: 'end', now: at(1) }).state
    return state
  }

  it('puts two tabs side by side in the first one\'s place, and shows the one that joined', () => {
    const before = three()
    const { state, split } = splitTabs(before, 'b', 'c', at(2))
    expect(split!.kind).toBe('split')
    const today = rows(state, 'today')
    expect(today.map(row => row.item.id)).toEqual(['a', split!.id])
    expect(today[1]!.panes!.map(pane => pane.id)).toEqual(['b', 'c'])
    expect(splitOf(state, 'c')!.panes.map(pane => pane.id)).toEqual(['b', 'c'])
    expect(splitOf(state, 'a')).toBeNull()
    expect(state.selected.s1).toBe('c')
    expect(tabOrder(state).map(tab => tab.id)).toEqual(['a', 'b', 'c'])
  })

  it('adds panes up to four, and refuses favorites and folders', () => {
    let state = three()
    for (const id of ['d', 'e']) state = openTab(state, { url: `https://${id}.com`, id, place: 'end', now: at(1) }).state
    const split = splitTabs(state, 'a', 'b').split!
    state = splitTabs(state, 'a', 'b').state
    state = splitTabs(state, 'b', 'c').state
    state = splitTabs(state, 'c', 'd').state
    expect(splitOf(state, 'a')!.panes).toHaveLength(SPLIT_LIMIT)
    expect(splitTabs(state, 'a', 'e').state).toBe(state)
    expect(moveItem(state, 'e', { inside: splitOf(state, 'a')!.split.id })).toBe(state)
    expect(split.kind).toBe('split')
    let favored = addFavorite(three(), 'a')
    expect(splitTabs(favored, 'a', 'b').split).toBeNull()
    favored = createFolder(favored, { id: 'f' }).state
    expect(splitTabs(favored, 'f', 'b').split).toBeNull()
  })

  it('becomes a plain tab again when one pane is left, whether it closed, left or moved', () => {
    const base = splitTabs(three(), 'b', 'c').state
    const splitId = splitOf(base, 'b')!.split.id
    const order = base.items[splitId]!.order

    const closed = closeTab(base, 'c').state
    expect(closed.items[splitId]).toBeUndefined()
    expect(closed.items.b).toMatchObject({ parent: null, order })
    expect(rows(closed, 'today').map(row => row.item.id)).toEqual(['a', 'b'])

    const left = leaveSplit(base, 'b')
    expect(left.items[splitId]).toBeUndefined()
    expect(rows(left, 'today').map(row => row.item.id)).toEqual(['a', 'c', 'b'])

    const pinned = pinTab(base, 'c')
    expect(pinned.items[splitId]).toBeUndefined()
    expect(rows(pinned, 'pinned').map(row => row.item.id)).toEqual(['c'])

    const cleared = clearToday(base).state
    expect(Object.keys(cleared.items)).toEqual([])
  })

  it('pins as one row, the panes keeping their own addresses, and shows the first pane from its row', () => {
    let state = splitTabs(three(), 'b', 'c').state
    const splitId = splitOf(state, 'b')!.split.id
    state = moveItem(state, splitId, 'start')
    state = pinTab(state, splitId)
    expect(rows(state, 'pinned').map(row => row.item.id)).toEqual([splitId])
    expect(state.items.b!.section).toBe('pinned')
    expect(state.items.c!.savedUrl).toBe('https://c.com')
    state = selectTab(state, 'a')
    expect(selectTab(state, splitId).selected.s1).toBe('b')
  })
})
