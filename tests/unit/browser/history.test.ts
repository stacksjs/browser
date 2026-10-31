import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseOrm } from '@stacksjs/query-builder'
import type { History } from '../../../app/Desktop/history'
import { openHistory } from '../../../app/Desktop/history'
import { historyApi } from '../../../app/Desktop/history-api'

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const open: History[] = []
const dirs: string[] = []

function history(path = ':memory:'): History {
  const store = openHistory(path)
  open.push(store)
  return store
}

afterEach(() => {
  for (const store of open.splice(0)) store.close()
  releaseOrm()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('history', () => {
  it('keeps one row per page, counting visits and keeping the latest title', () => {
    const store = history()
    store.record([
      { url: 'https://github.com/pulls', title: 'Pull Requests', at: NOW - 2 * DAY },
      { url: 'https://github.com/pulls', title: 'Pull requests · GitHub', at: NOW - DAY },
      { url: 'about:blank', at: NOW },
      { url: 'data:text/html,hi', at: NOW },
    ])
    const [page, ...rest] = store.recent()
    expect(rest).toEqual([])
    expect(page).toMatchObject({ url: 'https://github.com/pulls', title: 'Pull requests · GitHub', lastVisitAt: NOW - DAY })
  })

  it('finds pages by any part of their address or title, every word required', () => {
    const store = history()
    store.record([
      { url: 'https://github.com/stacksjs/stacks/pulls', title: 'Pull requests · stacksjs/stacks', at: NOW },
      { url: 'https://news.ycombinator.com/', title: 'Hacker News', at: NOW },
      { url: 'https://example.com/hub', title: 'Example', at: NOW },
    ])
    expect(store.search('hub', 8, NOW).map(result => result.url).sort()).toEqual(['https://example.com/hub', 'https://github.com/stacksjs/stacks/pulls'])
    expect(store.search('hub pull', 8, NOW).map(result => result.url)).toEqual(['https://github.com/stacksjs/stacks/pulls'])
    expect(store.search('hacker', 8, NOW)[0]?.title).toBe('Hacker News')
    expect(store.search('"); DROP TABLE history_entries; --', 8, NOW)).toEqual([])
    expect(store.recent()).toHaveLength(3)
  })

  it('answers one and two letters from the start of a host or title', () => {
    const store = history()
    store.record([
      { url: 'https://github.com/', title: 'GitHub', at: NOW },
      { url: 'https://gmail.com/', title: 'Inbox', at: NOW },
      { url: 'https://example.com/g', title: 'Example', at: NOW },
    ])
    expect(store.search('g', 8, NOW).map(result => result.url).sort()).toEqual(['https://github.com/', 'https://gmail.com/'])
    expect(store.search('gi', 8, NOW).map(result => result.url)).toEqual(['https://github.com/'])
    expect(store.search('%', 8, NOW)).toEqual([])
  })

  it('ranks the page used more, and more recently, first', () => {
    const store = history()
    const often = Array.from({ length: 12 }, (_, i) => ({ url: 'https://docs.stacksjs.com/', title: 'Stacks docs', at: NOW - i * DAY }))
    store.record([...often, { url: 'https://stacksjs.com/', title: 'Stacks', at: NOW - 200 * DAY }])
    const results = store.search('stacks', 8, NOW)
    expect(results.map(result => result.url)).toEqual(['https://docs.stacksjs.com/', 'https://stacksjs.com/'])
    expect(results[0]!.frecency).toBeGreaterThan(results[1]!.frecency * 10)
  })

  it('takes a title that arrives later, and forgets pages', () => {
    const store = history()
    store.record([{ url: 'https://a.com/', at: NOW }])
    store.retitle([{ url: 'https://a.com/', title: 'Alpha' }])
    expect(store.search('alpha', 8, NOW)[0]?.url).toBe('https://a.com/')
    store.forget('https://a.com/')
    expect(store.search('alpha', 8, NOW)).toEqual([])
    store.record([{ url: 'https://b.com/', at: NOW }])
    store.clear()
    expect(store.recent()).toEqual([])
  })

  it('keeps everything, index included, across a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-history-'))
    dirs.push(dir)
    const path = join(dir, 'Browser.sqlite')
    const first = openHistory(path)
    first.record([{ url: 'https://kept.example/', title: 'Kept page', at: NOW }])
    first.close()
    releaseOrm()
    expect(history(path).search('kept', 8, NOW)[0]?.title).toBe('Kept page')
  })
})

describe('history api', () => {
  const api = () => {
    const store = history()
    return { store, api: historyApi(() => store) }
  }
  const at = (path: string, init?: RequestInit) => new Request(`http://127.0.0.1:4000/api/history${path}`, init)

  it('records a batch, then answers a search and the latest pages', async () => {
    const { api: routes } = api()
    const body = { visits: [{ url: 'https://github.com/', title: 'GitHub', at: NOW }, { url: 42 }, { url: 'https://x.com/', at: 'soon' }], titles: [{ url: 'https://github.com/', title: 'GitHub Home' }] }
    const saved = await routes.record(at('', { method: 'POST', body: JSON.stringify(body) }))
    expect(saved.status).toBe(204)
    const found = await routes.search(at('?q=git')).json() as { data: Array<{ title: string }> }
    expect(found.data.map(page => page.title)).toEqual(['GitHub Home'])
    const latest = await routes.search(at('?limit=500')).json() as { data: unknown[] }
    expect(latest.data).toHaveLength(1)
  })

  it('refuses a body that is not JSON, and forgets one page or all', async () => {
    const { store, api: routes } = api()
    expect((await routes.record(at('', { method: 'POST', body: 'nope' }))).status).toBe(400)
    store.record([{ url: 'https://a.com/', at: NOW }, { url: 'https://b.com/', at: NOW }])
    routes.forget(at(`?url=${encodeURIComponent('https://a.com/')}`, { method: 'DELETE' }))
    expect(store.recent().map(page => page.url)).toEqual(['https://b.com/'])
    routes.forget(at('', { method: 'DELETE' }))
    expect(store.recent()).toEqual([])
  })
})
