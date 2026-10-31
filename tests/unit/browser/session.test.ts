import { afterEach, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseOrm } from '@stacksjs/query-builder'
import { openBrowserDatabase } from '../../../app/Desktop/database'
import { createHistory } from '../../../app/Desktop/history'
import { ARCHIVE_DAYS, createSession } from '../../../app/Desktop/session'
import { sessionApi, sessionChangeFrom } from '../../../app/Desktop/session-api'
import { createSessionClient, diffSession } from '../../../resources/functions/browser/session'
import type { BrowserState } from '../../../resources/functions/browser/sidebar'
import { clearToday, closeTab, createFolder, createSpace, createState, moveItem, openTab, pinTab, updateItem, updateSpace } from '../../../resources/functions/browser/sidebar'

const NOW = 1_800_000_000_000
const DAY = 86_400_000
const open: Database[] = []
const dirs: string[] = []

function database(path = ':memory:'): Database {
  const db = openBrowserDatabase(path)
  open.push(db)
  return db
}

afterEach(() => {
  for (const db of open.splice(0)) db.close()
  releaseOrm()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A sidebar with a pinned folder holding a tab, a favorite, two Today tabs and a second space. */
function sample(): BrowserState {
  let state = createState({ id: 'personal', name: 'Personal', icon: '🏠' })
  state = createSpace(state, { id: 'work', name: 'Work' }).state
  state = openTab(state, { id: 'docs', url: 'https://docs.stacksjs.com/', title: 'Docs', now: NOW }).state
  state = pinTab(state, 'docs')
  state = createFolder(state, { id: 'reading', title: 'Reading', now: NOW }).state
  state = moveItem(state, 'docs', { inside: 'reading' })
  state = openTab(state, { id: 'mail', url: 'https://mail.example/', section: 'favorites', now: NOW }).state
  state = openTab(state, { id: 'news', url: 'https://news.ycombinator.com/', title: 'Hacker News', now: NOW }).state
  state = openTab(state, { id: 'gh', url: 'https://github.com/', now: NOW }).state
  return updateItem(state, 'gh', { icon: 'https://github.com/favicon.ico', name: 'Code' })
}

describe('diffSession', () => {
  it('sends everything the first time and nothing when nothing changed', () => {
    const state = sample()
    const first = diffSession(null, state)!
    expect(first.spaces).toHaveLength(2)
    expect(first.put!.map(item => item.id).sort()).toEqual(['docs', 'gh', 'mail', 'news', 'reading'])
    expect(first.remove).toBeUndefined()
    expect(diffSession(state, state)).toBeNull()
  })

  it('sends only the rows that changed, and the ones that left', () => {
    const before = sample()
    const retitled = updateItem(before, 'news', { title: 'HN' })
    expect(diffSession(before, retitled)).toEqual({ put: [retitled.items.news!] })
    const closed = closeTab(retitled, 'gh').state
    const change = diffSession(retitled, closed)!
    expect(change.remove).toEqual(['gh'])
    expect(change.put).toBeUndefined()
    expect(change.closed!.map(item => item.id)).toEqual(['gh'])
  })
})

describe('session store', () => {
  it('has nothing before the first save, then gives the sidebar back as it was', () => {
    const session = createSession(database())
    expect(session.load()).toBeNull()
    const state = sample()
    session.save(diffSession(null, state)!, NOW)
    expect(session.load()).toEqual(state)
  })

  it('applies changes, keeps what left the sidebar in the archive, and prunes it later', () => {
    const session = createSession(database())
    let state = sample()
    session.save(diffSession(null, state)!, NOW)
    let next = updateSpace(state, 'work', { name: 'Office', icon: '💼' })
    next = clearToday(next).state
    session.save(diffSession(state, next)!, NOW)
    state = next
    expect(session.load()).toEqual(state)
    expect(session.archived().map(item => item.id).sort()).toEqual(['gh', 'news'])
    expect(session.archived()[0]!.archivedAt).toBe(NOW)

    // A tab put back (reopened) leaves the archive.
    next = openTab(state, { id: 'news', url: 'https://news.ycombinator.com/', now: NOW + 1 }).state
    session.save(diffSession(state, next)!, NOW + 1)
    expect(session.archived().map(item => item.id)).toEqual(['gh'])
    session.prune(NOW + (ARCHIVE_DAYS + 1) * DAY)
    expect(session.archived()).toEqual([])
    expect(Object.keys(session.load()!.items).sort()).toEqual(['docs', 'mail', 'news', 'reading'])
  })

  it('drops a space that is gone, and falls back to the first when the active one is', () => {
    const session = createSession(database())
    const state = sample()
    session.save(diffSession(null, state)!, NOW)
    session.save({ spaces: [state.spaces[1]!] }, NOW)
    const loaded = session.load()!
    expect(loaded.spaces.map(space => space.id)).toEqual(['work'])
    expect(loaded.activeSpace).toBe('work')
  })

  it('shares one database with history, and keeps both across a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browser-session-'))
    dirs.push(dir)
    const path = join(dir, 'Browser.sqlite')
    const state = sample()
    const first = openBrowserDatabase(path)
    createSession(first).save(diffSession(null, state)!, NOW)
    createHistory(first).record([{ url: 'https://github.com/', title: 'GitHub', at: NOW }])
    first.close()
    releaseOrm()
    const db = database(path)
    expect(createSession(db).load()).toEqual(state)
    expect(createHistory(db).search('github', 8, NOW)[0]?.title).toBe('GitHub')
  })
})

describe('session api', () => {
  it('refuses what the screen would never send', () => {
    expect(sessionChangeFrom([])).toBe('Expected an object')
    expect(sessionChangeFrom({ spaces: [] })).toMatch(/spaces/)
    expect(sessionChangeFrom({ put: [{ id: 'x', kind: 'window', section: 'today', order: 'a', createdAt: 1, lastActiveAt: 1 }] })).toMatch(/put/)
    expect(sessionChangeFrom({ remove: [1] })).toMatch(/remove/)
    expect(sessionChangeFrom({ selected: { personal: 3 } })).toMatch(/selected/)
    expect(sessionChangeFrom({ activeSpace: 'work', extra: true })).toEqual({ activeSpace: 'work' })
  })

  it('saves over PUT and loads over GET, through the client', async () => {
    const session = createSession(database())
    const routes = sessionApi(() => session)
    const fetch = async (url: string, init?: RequestInit) => {
      const request = new Request(`http://127.0.0.1:4000${url}`, init)
      return request.method === 'PUT' ? routes.save(request) : routes.load()
    }
    const client = createSessionClient({ base: '', fetch, flushAfter: 60_000 })
    expect(await client.load()).toBeNull()
    const state = sample()
    client.save(state)
    expect(await client.flush()).toBe(true)
    const next = updateItem(state, 'news', { title: 'HN' })
    client.save(next)
    expect(await client.flush()).toBe(true)
    expect(await createSessionClient({ base: '', fetch }).load()).toEqual(next)
    expect((await routes.save(new Request('http://x/api/session', { method: 'PUT', body: 'nope' }))).status).toBe(400)
  })

  it('sends what a failed save missed with the next one', async () => {
    const sent: any[] = []
    let up = false
    const fetch = async (_url: string, init?: RequestInit) => {
      if (!up) throw new Error('offline')
      sent.push(JSON.parse(String(init!.body)))
      return new Response(null, { status: 204 })
    }
    const client = createSessionClient({ base: '', fetch, flushAfter: 60_000 })
    const state = sample()
    client.save(state)
    expect(await client.flush()).toBe(false)
    up = true
    client.save(updateItem(state, 'news', { title: 'HN' }))
    expect(await client.flush()).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].put.find((item: { id: string }) => item.id === 'news').title).toBe('HN')
    expect(sent[0].spaces).toHaveLength(2)
  })
})
