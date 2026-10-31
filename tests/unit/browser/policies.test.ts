import { describe, expect, it } from 'bun:test'
import { arcTheme, chromiumTime, importArcSidebar } from '../../../resources/functions/browser/arc-import'
import { PRESSURE_POLICY, tabsToSleep } from '../../../resources/functions/browser/hibernation'
import { browserMenus, commandIds } from '../../../resources/functions/browser/keymap'
import { frecency, rank } from '../../../resources/functions/browser/rank'
import { rows } from '../../../resources/functions/browser/sidebar'
import { arcFixture as fixture } from './fixtures/arc'

const MINUTE = 60_000
const DAY = 86_400_000

describe('sleeping tabs', () => {
  const now = 10 * DAY
  const tab = (id: string, minutesAgo: number, extra: object = {}) => ({ id, lastActiveAt: now - minutesAgo * MINUTE, live: true, visible: false, ...extra })

  it('puts long-unseen tabs to sleep, pinned ones later, and never what is shown or busy', () => {
    const tabs = [
      tab('shown', 999, { visible: true }), tab('music', 999, { busy: true }), tab('old', 45), tab('fresh', 5),
      tab('pinned-old', 45, { pinned: true }), tab('pinned-ancient', 300, { pinned: true }), tab('asleep', 999, { live: false }),
    ]
    expect(tabsToSleep(tabs, now)).toEqual(['pinned-ancient', 'old'])
  })

  it('keeps at most maxLive pages, sending the longest unseen first', () => {
    const tabs = Array.from({ length: 6 }, (_, index) => tab(`t${index}`, index + 1))
    expect(tabsToSleep(tabs, now, { idleMs: DAY, pinnedIdleMs: DAY, maxLive: 4 })).toEqual(['t5', 't4'])
  })

  it('keeps only what is on screen and busy under memory pressure', () => {
    const tabs = [tab('shown', 1, { visible: true }), tab('call', 1, { busy: true }), tab('a', 1), tab('b', 2, { pinned: true })]
    expect(tabsToSleep(tabs, now, PRESSURE_POLICY).sort()).toEqual(['a', 'b'])
  })
})

describe('the command bar', () => {
  const now = 100 * DAY

  it('weighs recent visits over old ones, and more visits over fewer', () => {
    const recent = frecency([{ at: now - DAY }, { at: now - 2 * DAY }], now)
    const old = frecency([{ at: now - 200 * DAY }, { at: now - 201 * DAY }], now)
    const many = frecency(Array.from({ length: 30 }, () => ({ at: now - 200 * DAY })), now)
    expect(recent).toBeGreaterThan(old)
    expect(many).toBeGreaterThan(old)
    expect(frecency([], now)).toBe(0)
  })

  it('requires every word, prefers the start of a host, and lists a page once with its open tab first', () => {
    const results = rank('git pull', [
      { kind: 'history', id: 'h1', title: 'Pull requests · stacksjs/stacks', url: 'https://github.com/stacksjs/stacks/pulls', frecency: 900 },
      { kind: 'tab', id: 't1', title: 'Pull requests · stacksjs/stacks', url: 'https://github.com/stacksjs/stacks/pulls' },
      { kind: 'history', id: 'h2', title: 'Git push docs', url: 'https://git-scm.com/docs/git-push', frecency: 2000 },
      { kind: 'history', id: 'h3', title: 'Pulling git repositories', url: 'https://example.com/guide', frecency: 50 },
      { kind: 'suggestion', id: 's1', title: 'git pull rebase' },
    ])
    expect(results.map(result => result.id)).toEqual(['t1', 'h3', 's1'])
  })

  it('ranks a much-visited page above a rarely visited one that matches as well', () => {
    const results = rank('docs', [
      { kind: 'history', id: 'rare', title: 'Docs', url: 'https://a.example/docs', frecency: 10 },
      { kind: 'history', id: 'daily', title: 'Docs', url: 'https://b.example/docs', frecency: 5000 },
    ])
    expect(results[0]!.id).toBe('daily')
  })
})

describe('the keyboard', () => {
  it('has Arc\'s keys, each once, and an id for every command', () => {
    const shortcuts = browserMenus().flatMap(menu => menu.items).filter(item => item.shortcut).map(item => item.shortcut!)
    expect(new Set(shortcuts).size).toBe(shortcuts.length)
    expect(shortcuts).toEqual(expect.arrayContaining(['cmd+t', 'cmd+s', 'cmd+d', 'cmd+shift+c', 'ctrl+1', 'cmd+1', 'cmd+alt+n', 'cmd+shift+t', 'ctrl+tab']))
    const ids = commandIds()
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('importing Arc', () => {

  it('brings spaces, folders, splits, Today and favorites, in Arc\'s order, skipping what has no counterpart', () => {
    const { state, report } = importArcSidebar(fixture, 1_800_000_000_000)
    expect(report).toEqual({ spaces: 1, pinned: 4, today: 1, favorites: 1, folders: 1, splits: 1, skipped: { easel: 1, arcDocument: 1 } })
    expect(state.activeSpace).toBe('sp1')
    expect(state.spaces[0]).toMatchObject({ name: 'Personal', icon: 'star', profile: 'default' })
    expect(rows(state, 'pinned').map(row => `${row.item.id}:${row.depth}${row.panes ? `[${row.panes.map(pane => pane.id).join(',')}]` : ''}`))
      .toEqual(['folder:0', 'jira:1', 'mail:0', 'split:0[left,right]'])
    expect(state.items.mail).toMatchObject({ title: 'My Mail', url: 'https://mail.example', savedUrl: 'https://mail.example' })
    expect(state.items.jira!.icon).toBe('🧭')
    expect(rows(state, 'today').map(row => row.item.id)).toEqual(['news'])
    expect(state.items.news!.savedUrl).toBeUndefined()
    expect(state.items.news!.lastActiveAt).toBe(1_710_000_000_000)
    expect(rows(state, 'favorites').map(row => row.item.id)).toEqual(['cal'])
  })

  it('keeps each space\'s own light and dark colours', () => {
    const theme = arcTheme(fixture.sidebar.containers[1]!.spaces![1]!.customInfo)
    expect(theme.light).toMatchObject({ background: '#ccd1fc', foreground: '#0d0d33', hover: '#ffffff66', selected: '#ffffffcc' })
    expect(theme.light.backgroundTo).toMatch(/^#[0-9a-f]{6}$/)
    expect(theme.dark.background).toBe('#262659')
  })

  it('reads Chromium history times', () => {
    expect(chromiumTime(13_300_000_000_000_000)).toBe(1_655_526_400_000)
  })

  it('survives an empty or foreign file', () => {
    expect(importArcSidebar({}).state.spaces).toHaveLength(1)
    expect(importArcSidebar({ sidebar: { containers: [{ spaces: 'nope', items: 7 }] } }).report.pinned).toBe(0)
  })
})
