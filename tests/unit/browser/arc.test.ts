import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseOrm } from '@stacksjs/query-builder'
import { arcApi, previewArc } from '../../../app/Desktop/arc'
import { openBrowserDatabase } from '../../../app/Desktop/database'
import { createHistory } from '../../../app/Desktop/history'
import { importArcSidebar, mergeImported } from '../../../resources/functions/browser/arc-import'
import { addFavorite, createState, openTab, rows } from '../../../resources/functions/browser/sidebar'
import { arcFixture } from './fixtures/arc'

const cleanup: Array<() => void> = []
afterEach(() => {
  for (const done of cleanup.splice(0)) done()
  releaseOrm()
})

/** A folder shaped like ~/Library/Application Support/Arc, with a sidebar and a Chromium History database. */
function arcFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'browser-arc-test-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'StorableSidebar.json'), JSON.stringify(arcFixture))
  mkdirSync(join(dir, 'User Data', 'Default'), { recursive: true })
  const history = new Database(join(dir, 'User Data', 'Default', 'History'))
  history.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)')
  const add = history.query('INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)')
  add.run('https://github.com/', 'GitHub', 40, 13_400_000_000_000_000, 0)
  add.run('https://news.example/', 'News', 3, 13_390_000_000_000_000, 0)
  add.run('chrome://settings', 'Settings', 9, 13_400_000_000_000_000, 0)
  add.run('https://hidden.example/', 'Hidden', 1, 13_400_000_000_000_000, 1)
  history.close()
  return dir
}

describe('importing from Arc', () => {
  it('previews counts from copies of Arc\'s files, and says when there is no Arc', () => {
    const preview = previewArc(arcFolder())
    expect(preview).toMatchObject({ found: true, historyPages: 3, report: { spaces: 1, pinned: 4, favorites: 1 } })
    expect(previewArc(join(tmpdir(), 'no-arc-here'))).toEqual({ found: false })
  })

  it('brings the sidebar to the window and the history into the database, keeping visit counts', async () => {
    const dir = arcFolder()
    const db = openBrowserDatabase(':memory:')
    cleanup.push(() => db.close())
    const history = createHistory(db)
    const routes = arcApi(() => history, () => dir)
    const { data } = await routes.run().json() as { data: { state: any, historyImported: number } }
    expect(data.historyImported).toBe(2)
    expect(Object.keys(data.state.items)).toContain('mail')
    const github = history.search('github', 5)[0]!
    expect(github).toMatchObject({ url: 'https://github.com/', title: 'GitHub' })
    expect(history.search('news', 5)[0]!.frecency).toBeLessThan(github.frecency)
    // A second import adds nothing new.
    expect(((await routes.run().json()) as { data: { historyImported: number } }).data.historyImported).toBe(0)
  })

  it('replaces an empty sidebar, and otherwise adds Arc\'s spaces and favorites after the existing ones', () => {
    const imported = importArcSidebar(arcFixture).state
    const empty = createState({ id: 'mine' })
    expect(mergeImported(empty, imported)).toBe(imported)
    let mine = createState({ id: 'mine', name: 'Mine' })
    mine = openTab(mine, { id: 'own', url: 'https://own.example', now: 1 }).state
    mine = addFavorite(mine, 'own')
    const merged = mergeImported(mine, imported)
    expect(merged.spaces.map(space => space.id)).toEqual(['mine', 'sp1'])
    expect(rows(merged, 'favorites').map(row => row.item.id)).toEqual(['own', 'cal'])
    expect(merged.activeSpace).toBe('mine')
    expect(rows(merged, 'pinned', 'sp1').length).toBeGreaterThan(0)
    expect(mergeImported(merged, imported)).toEqual(merged)
  })
})

describe('onboarding', () => {
  it('walks its steps in order and sums an import up in words', async () => {
    const { importSummary, nextStep } = await import('../../../resources/functions/browser/onboarding')
    expect(nextStep('welcome')).toBe('import')
    expect(nextStep('done')).toBeNull()
    expect(importSummary({ spaces: 3, pinned: 12, today: 0, favorites: 1, folders: 2, splits: 0, skipped: {} }, 2000)).toBe('3 spaces, 12 pinned tabs, 1 favorite and 2,000 pages of history')
    expect(importSummary({ spaces: 1, pinned: 0, today: 0, favorites: 0, folders: 0, splits: 0, skipped: {} })).toBe('1 space')
    expect(importSummary(undefined)).toBe('Nothing to bring over yet.')
  })
})
