import { afterEach, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { releaseOrm } from '@stacksjs/query-builder'
import { openBrowserDatabase } from '../../../app/Desktop/database'
import { createDownloads } from '../../../app/Desktop/downloads'
import { downloadFrom, downloadsApi } from '../../../app/Desktop/downloads-api'
import { createSession } from '../../../app/Desktop/session'
import { sessionApi } from '../../../app/Desktop/session-api'
import { applyDownload, createLibraryClient, downloadFraction, formatBytes, formatTime, groupByDay } from '../../../resources/functions/browser/library'
import { diffSession } from '../../../resources/functions/browser/session'
import { clearToday, createState, openTab, splitTabs } from '../../../resources/functions/browser/sidebar'

const open: Database[] = []
function database(): Database {
  const db = openBrowserDatabase(':memory:')
  open.push(db)
  return db
}
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  releaseOrm()
})

describe('downloads', () => {
  it('follow Craft\'s reports from start to finish', () => {
    let download = applyDownload(undefined, { id: 'd1', state: 'started', url: 'https://x.com/a.zip', path: '/Users/me/Downloads/a.zip', name: 'a.zip', total: 2000 }, 10)
    expect(download).toMatchObject({ state: 'started', startedAt: 10, total: 2000, received: 0 })
    expect(downloadFraction(download)).toBe(0)
    download = applyDownload(download, { id: 'd1', state: 'progress', received: 500, total: -1 }, 11)
    expect(downloadFraction(download)).toBe(0.25)
    download = applyDownload(download, { id: 'd1', state: 'finished' }, 12)
    expect(download).toMatchObject({ state: 'finished', received: 2000, finishedAt: 12, name: 'a.zip' })
    expect(downloadFraction(applyDownload(undefined, { id: 'd2', state: 'progress', received: 9 }))).toBeNull()
  })

  it('count bytes the way Finder does', () => {
    expect(formatBytes(0)).toBe('Zero bytes')
    expect(formatBytes(1)).toBe('1 byte')
    expect(formatBytes(999)).toBe('999 bytes')
    expect(formatBytes(1400)).toBe('1.4 KB')
    expect(formatBytes(1_000_000)).toBe('1 MB')
    expect(formatBytes(253_400_000)).toBe('253 MB')
  })

  it('are kept by the agent, newest first, and cleared once they end', async () => {
    const downloads = createDownloads(database())
    const routes = downloadsApi(() => downloads)
    const fetch = async (url: string, init?: RequestInit) => {
      const request = new Request(`http://127.0.0.1${url}`, init)
      return request.method === 'POST' ? routes.record(request) : request.method === 'DELETE' ? routes.clear() : routes.list(request)
    }
    const library = createLibraryClient({ base: '', fetch })
    await library.recordDownload({ id: 'old', url: 'https://x.com/1', path: '/d/1', name: '1', state: 'finished', received: 5, total: 5, startedAt: 1, finishedAt: 2 })
    await library.recordDownload({ id: 'new', url: 'https://x.com/2', path: '/d/2', name: '2', state: 'started', received: 0, total: 9, startedAt: 3 })
    expect((await library.downloads()).map(each => each.id)).toEqual(['new', 'old'])
    await library.clearDownloads()
    expect((await library.downloads()).map(each => each.id)).toEqual(['new'])
    expect(downloadFrom({ id: 'x', state: 'exploded' })).toBeNull()
    expect((await routes.record(new Request('http://x/api/downloads', { method: 'POST', body: '{}' }))).status).toBe(422)
  })
})

describe('the archive', () => {
  it('lists tabs that left the sidebar, never the split views that held them', async () => {
    const session = createSession(database())
    let state = createState({ id: 's' })
    for (const id of ['a', 'b']) state = openTab(state, { id, url: `https://${id}.com`, place: 'end', now: 1 }).state
    state = splitTabs(state, 'a', 'b', 2).state
    session.save(diffSession(null, state)!, 2)
    const cleared = clearToday(state).state
    session.save(diffSession(state, cleared)!, 3)
    const routes = sessionApi(() => session)
    const library = createLibraryClient({ base: '', fetch: async url => routes.archived(new Request(`http://127.0.0.1${url}`)) })
    expect((await library.archived()).map(tab => tab.id).sort()).toEqual(['a', 'b'])
  })

  it('reads empty when the agent is away', async () => {
    const library = createLibraryClient({ base: '', fetch: async () => { throw new Error('down') } })
    expect(await library.archived()).toEqual([])
    expect(await library.history('x')).toEqual([])
  })
})

describe('day groups', () => {
  it('put entries under Today, Yesterday, a weekday, then a date', () => {
    const now = new Date(2026, 9, 31, 15).getTime()
    const at = (day: number, hour = 9) => new Date(2026, 9, day, hour).getTime()
    const groups = groupByDay([at(31, 8), at(31, 14), at(30), at(28), at(2), new Date(2025, 11, 25).getTime()], value => value, now)
    expect(groups.map(group => group.label)).toEqual(['Today', 'Yesterday', 'Wednesday', 'October 2', 'December 25, 2025'])
    expect(groups[0]!.entries).toEqual([at(31, 14), at(31, 8)])
    expect([formatTime(at(31, 0)), formatTime(new Date(2026, 9, 31, 15, 7).getTime()), formatTime(at(31, 12))]).toEqual(['12:00 AM', '3:07 PM', '12:00 PM'])
  })
})
