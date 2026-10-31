import { describe, expect, it } from 'bun:test'
import { tabsToSleep } from '../../../resources/functions/browser/hibernation'
import { createPages } from '../../../resources/functions/browser/pages'
import { createState, openTab } from '../../../resources/functions/browser/sidebar'

function fakeWeb() {
  const calls: string[] = []
  return {
    calls,
    create: async (options: { id: string, url?: string }) => { calls.push(`create ${options.id} ${options.url ?? ''}`) },
    close: async (id: string) => { calls.push(`close ${id}`) },
  }
}

describe('pages', () => {
  it('gives a tab its page on first show only, and again after it was released', async () => {
    const web = fakeWeb()
    const pages = createPages(web)
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://a.com', id: 'a', now: 1 }).state
    await pages.show(state.items.a!, 'default', 2)
    await pages.show(state.items.a!, 'default', 3)
    expect(web.calls).toEqual(['create a https://a.com'])
    await pages.release(['a', 'never'])
    expect(pages.has('a')).toBe(false)
    await pages.show(state.items.a!, 'default', 4)
    expect(web.calls).toEqual(['create a https://a.com', 'close a', 'create a https://a.com'])
  })

  it('reports what hibernation needs, and sleeps the right tab', async () => {
    const web = fakeWeb()
    const pages = createPages(web)
    let state = createState({ id: 's1' })
    for (const id of ['a', 'b', 'c']) state = openTab(state, { url: `https://${id}.com`, id, now: 0 }).state
    await pages.show(state.items.a!, 'default', 0)
    await pages.show(state.items.b!, 'default', 50 * 60_000)
    pages.adopt('c', 0)
    const activity = pages.activity(state, new Set(['b']), new Set(['c']))
    expect(activity.map(tab => tab.id).sort()).toEqual(['a', 'b', 'c'])
    expect(tabsToSleep(activity, 60 * 60_000)).toEqual(['a'])
  })

  it('asks again for a page that failed to appear', async () => {
    let fail = true
    const pages = createPages({ create: async () => { if (fail) throw new Error('no') }, close: async () => {} })
    let state = createState({ id: 's1' })
    state = openTab(state, { url: 'https://a.com', id: 'a', now: 0 }).state
    await pages.show(state.items.a!, 'default').catch(() => {})
    expect(pages.has('a')).toBe(false)
    fail = false
    await pages.show(state.items.a!, 'default')
    expect(pages.has('a')).toBe(true)
  })
})
