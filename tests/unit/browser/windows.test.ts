import { describe, expect, it } from 'bun:test'
import { createPages } from '../../../resources/functions/browser/pages'
import { createSessionClient, diffSession } from '../../../resources/functions/browser/session'
import type { BrowserState } from '../../../resources/functions/browser/sidebar'
import { closeTab, createSpace, createState, openTab, pinTab, selectTab, switchSpace } from '../../../resources/functions/browser/sidebar'
import { applySharedChange, sharedChange, shownElsewhere, snapshot, windowMessage, withView } from '../../../resources/functions/browser/windows'

const NOW = 1_800_000_000_000

/** Two windows over one sidebar: a change in one, sent as messages are, applied in the other. */
function twoWindows() {
  let base = createState({ name: 'Personal', id: 'home' })
  base = openTab(base, { url: 'https://github.com/', id: 'gh', now: NOW }).state
  base = openTab(base, { url: 'https://news.example/', id: 'news', now: NOW }).state
  return { a: base, b: base }
}
/** What `craft.desktop.post` does to a message: structured data, no shared references. */
const sent = <T>(value: T): T => JSON.parse(JSON.stringify(value))

describe('one sidebar across windows', () => {
  it('shares rows, spaces and closed tabs, never a window\'s space or selection', () => {
    const { a } = twoWindows()
    const space = createSpace(a, { name: 'Work', id: 'work' })
    const moved = switchSpace(space.state, 'work')
    expect(sharedChange(diffSession(space.state, moved))).toBeNull()
    expect(Object.keys(sharedChange(diffSession(a, space.state))!)).toEqual(['spaces'])
    const opened = openTab(a, { url: 'https://x.example/', id: 'x', now: NOW }).state
    expect(sharedChange(diffSession(a, opened))!.put!.map(item => item.id)).toEqual(['x'])
  })

  it('applies another window\'s new tab without moving this window\'s selection', () => {
    let { a, b } = twoWindows()
    b = selectTab(b, 'news', NOW)
    const next = openTab(a, { url: 'https://x.example/', id: 'x', now: NOW }).state
    const after = applySharedChange(b, sent(sharedChange(diffSession(a, next))!))
    expect(after.items.x?.url).toBe('https://x.example/')
    expect(after.selected.home).toBe('news')
    expect(after.activeSpace).toBe(b.activeSpace)
  })

  it('clears a selection whose tab another window closed, and follows spaces it removed', () => {
    let { a, b } = twoWindows()
    b = selectTab(b, 'gh', NOW)
    const closed = closeTab(a, 'gh').state
    let after = applySharedChange(b, sent(sharedChange(diffSession(a, closed))!))
    expect(after.items.gh).toBeUndefined()
    expect(after.selected.home).toBeNull()
    expect(after.closed.map(item => item.id)).toContain('gh')

    const work = createSpace(after, { name: 'Work', id: 'work' }).state
    after = switchSpace(work, 'work')
    const withoutWork = { ...work, spaces: work.spaces.filter(space => space.id !== 'work') }
    const followed = applySharedChange(after, sent(sharedChange(diffSession(work, withoutWork))!))
    expect(followed.activeSpace).toBe('home')
    expect('work' in followed.selected).toBe(false)
  })

  it('gives a new space a selection slot in every window', () => {
    const { a, b } = twoWindows()
    const work = createSpace(a, { name: 'Work', id: 'work' }).state
    expect(applySharedChange(b, sent(sharedChange(diffSession(a, work))!)).selected.work).toBeNull()
  })

  it('answers the same state when a change brings nothing new', () => {
    const { b } = twoWindows()
    expect(applySharedChange(b, {})).toBe(b)
  })

  it('brings a new window up to date with a snapshot that also drops rows gone since it loaded', () => {
    const { a } = twoWindows()
    const stale = openTab(a, { url: 'https://stale.example/', id: 'stale', now: NOW }).state
    const current = pinTab(a, 'gh')
    const updated = applySharedChange(stale, sent(snapshot(current)), { replace: true })
    expect(Object.keys(updated.items).sort()).toEqual(['gh', 'news'])
    expect(updated.items.gh?.section).toBe('pinned')
  })

  it('saves a second window\'s changes with the main window\'s space and selection', () => {
    const { a } = twoWindows()
    const view = { activeSpace: a.activeSpace, selected: a.selected }
    const elsewhere: BrowserState = { ...selectTab(a, 'news', NOW), activeSpace: 'home' }
    const saved = withView(elsewhere, view)
    expect(saved.selected).toBe(a.selected)
    expect(saved.items).toBe(elsewhere.items)
    expect(withView(a, view)).toBe(a)
  })

  it('knows which tabs other windows show, and reads only its own messages', () => {
    expect([...shownElsewhere({ 'window-1': ['a', 'b'], 'window-2': ['c'] })]).toEqual(['a', 'b', 'c'])
    expect(windowMessage({ type: 'showing', tabs: ['a', 3, 'b'] })).toEqual({ type: 'showing', tabs: ['a', 'b'] })
    expect(windowMessage({ type: 'take', tab: 'a' })).toEqual({ type: 'take', tab: 'a' })
    expect(windowMessage({ type: 'sidebar', change: { put: [] }, replace: true })).toEqual({ type: 'sidebar', change: { put: [] }, replace: true })
    expect(windowMessage({ type: 'adopt', tab: 't' })).toBeNull()
    expect(windowMessage('hello')).toBeNull()
  })
})

describe('saving once across windows', () => {
  it('does not send again what another window made and saves', async () => {
    const { a } = twoWindows()
    const bodies: unknown[] = []
    const client = createSessionClient({ base: '', flushAfter: 10_000, fetch: async (_url, init) => {
      if (init?.method === 'PUT') bodies.push(JSON.parse(String(init.body)))
      return Response.json({ data: a })
    } })
    // The screen holds the objects the client loaded, so unchanged rows compare by reference.
    const loaded = (await client.load())!

    const remote = sent(sharedChange(diffSession(a, openTab(a, { url: 'https://x.example/', id: 'x', now: NOW }).state))!)
    const update = (state: BrowserState) => applySharedChange(state, remote)
    client.acknowledge(update)
    const local = update(loaded)
    client.save(local)
    expect(await client.flush()).toBe(true)
    expect(bodies).toEqual([])

    // A change of this window's own still goes out.
    client.save(openTab(local, { url: 'https://y.example/', id: 'y', now: NOW }).state)
    await client.flush()
    expect((bodies[0] as { put: Array<{ id: string }> }).put.map(item => item.id)).toEqual(['y'])
  })
})

describe('pages handed between windows', () => {
  it('forgets a page another window took without closing it, and prunes pages that closed with a window', async () => {
    const closed: string[] = []
    const created: string[] = []
    const pages = createPages({ create: async ({ id }) => { created.push(id) }, close: async (id) => { closed.push(id) } })
    const { a } = twoWindows()
    await pages.show(a.items.gh!, 'default')
    await pages.show(a.items.news!, 'default')
    pages.forget('gh')
    expect(pages.has('gh')).toBe(false)
    expect(closed).toEqual([])
    pages.prune(new Set(['other']))
    expect(pages.has('news')).toBe(false)
    await pages.show(a.items.news!, 'default')
    expect(created).toEqual(['gh', 'news', 'news'])
  })
})
