import { afterAll, describe, expect, it } from 'bun:test'
import { releaseOrm } from '@stacksjs/query-builder'
import { openBrowserDatabase } from '../../app/Desktop/database'
import { createHistory } from '../../app/Desktop/history'
import { groupByDay } from '../../resources/functions/browser/library'
import { rank } from '../../resources/functions/browser/rank'
import { diffSession } from '../../resources/functions/browser/session'
import type { BrowserState } from '../../resources/functions/browser/sidebar'
import { createFolder, createState, moveItem, openTab, pinTab, rows, tabOrder, updateItem } from '../../resources/functions/browser/sidebar'

/**
 * The plan's budgets for what runs while someone browses, on the code itself:
 * a sidebar of 500 rows redraws, reorders and saves well inside one frame
 * (16 ms), and the command bar's first results arrive within 50 ms. The
 * median of many runs is measured, so one slow scheduling slot does not fail it.
 */

function median(run: () => unknown, times = 30): number {
  const samples: number[] = []
  for (let index = 0; index < times; index++) {
    const start = Bun.nanoseconds()
    run()
    samples.push((Bun.nanoseconds() - start) / 1e6)
  }
  return samples.sort((a, b) => a - b)[Math.floor(times / 2)]!
}

function bigSidebar(count = 500): BrowserState {
  let state = createState({ id: 's' })
  for (let index = 0; index < 20; index++) state = createFolder(state, { id: `f${index}`, title: `Folder ${index}`, now: 1 }).state
  for (let index = 0; index < count; index++) {
    state = openTab(state, { id: `t${index}`, url: `https://site${index}.example/page`, title: `Page number ${index}`, place: 'end', now: index }).state
    if (index % 2) state = pinTab(state, `t${index}`)
    if (index % 5 === 1) state = moveItem(state, `t${index}`, { inside: `f${index % 20}` })
  }
  return state
}

const sidebar = bigSidebar()
const FRAME = 16

describe('budgets: a 500-row sidebar', () => {
  it('draws its sections and tab order well inside a frame', () => {
    const ms = median(() => { rows(sidebar, 'pinned'); rows(sidebar, 'today'); tabOrder(sidebar) })
    expect(ms).toBeLessThan(FRAME / 2)
  })

  it('reorders a row, and works out what to save, inside a frame', () => {
    const ms = median(() => {
      const next = moveItem(sidebar, 't7', { before: 't3' })
      diffSession(sidebar, next)
    })
    expect(ms).toBeLessThan(FRAME / 2)
    const titled = updateItem(sidebar, 't8', { title: 'Renamed' })
    expect(diffSession(sidebar, titled)!.put).toHaveLength(1)
  })
})

describe('budgets: the command bar', () => {
  const candidates = Array.from({ length: 5000 }, (_, index) => ({ kind: index % 3 ? 'history' as const : 'tab' as const, id: `c${index}`, title: `Result ${index} about ${['github', 'docs', 'mail', 'news'][index % 4]}`, url: `https://host${index}.example/${index}`, frecency: index % 100 }))
  const db = openBrowserDatabase(':memory:')
  const history = createHistory(db)
  const now = Date.now()
  history.record(Array.from({ length: 20_000 }, (_, index) => ({ url: `https://site${index % 5000}.example/${index}`, title: `Page ${index} ${['github pulls', 'stacks docs', 'mail inbox', 'hacker news'][index % 4]}`, at: now - index * 60_000 })))
  afterAll(() => {
    db.close()
    releaseOrm()
  })

  it('ranks 5,000 open tabs and pages in a few milliseconds', () => {
    expect(median(() => rank('git hub', candidates, 8))).toBeLessThan(10)
  })

  it('searches 20,000 history pages within the 50 ms first-results budget', () => {
    expect(median(() => history.search('github pul', 8, now), 15)).toBeLessThan(50)
    expect(median(() => history.search('do', 8, now), 15)).toBeLessThan(50)
  })

  it('groups the Library\'s 5,000 entries by day inside a frame', () => {
    const entries = Array.from({ length: 5000 }, (_, index) => ({ at: now - index * 3_600_000 }))
    expect(median(() => groupByDay(entries, entry => entry.at, now))).toBeLessThan(FRAME)
  })
})
