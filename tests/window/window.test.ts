import { afterEach, describe, expect, it } from 'bun:test'
import { createState, openTab, pinTab } from '../../resources/functions/browser/sidebar'
import type { Browser } from './harness'
import { builtHost, openBrowser, settle } from './harness'

/**
 * The browser in its real window: Craft's AppKit host, zig-js running the
 * screen, WKWebView pages. These open windows on screen, so they run only when
 * asked (`bun run test:window`, which builds the app first).
 */
const enabled = process.env.BROWSER_WINDOW_TESTS === '1' && builtHost() !== null

/** A space with three Today tabs and a pinned one, on local fixture pages. */
function seeded(page: (name: string) => string) {
  let state = createState({ id: 'personal', name: 'Personal' })
  for (const id of ['alpha', 'beta', 'gamma', 'docs']) state = openTab(state, { id, url: page(id), place: 'end', now: Date.now() }).state
  state = pinTab(state, 'docs')
  return openTab(state, { id: 'alpha', url: page('alpha'), now: Date.now() }).state
}

let browser: Browser | null = null
afterEach(async () => {
  await browser?.close()
  browser = null
})

const location = async (tab: string) => (await browser!.act({ action: 'web', tab, js: 'location.pathname' })).value

describe.skipIf(!enabled)('the real window', () => {
  it('opens a second window over the same sidebar, and moves a page between windows', async () => {
    browser = await openBrowser(seeded)
    expect((await browser.act({ action: 'command', id: 'new-window' })).ok).toBe(true)
    await settle(3000)
    const second = browser.window('window-')!
    expect(second).toBeDefined()

    // The second window shows beta; the main one still shows alpha.
    expect((await browser.act({ action: 'press', target: 'today-beta', window: second })).ok).toBe(true)
    await settle(1500)
    expect(await location('beta')).toBe('/fixture/beta')

    // A navigation there retitles the row here (the change crossed windows).
    await browser.act({ action: 'command', id: 'open-location', window: second })
    await browser.act({ action: 'type', target: 'command', text: browser.page('delta').replace('http://', ''), window: second })
    await browser.act({ action: 'submit', target: 'command', window: second })
    await settle(1500)
    expect(await location('beta')).toBe('/fixture/delta')

    // A mark in the page, to tell a page that moved from one made again.
    await browser.act({ action: 'web', tab: 'beta', js: 'window.__moved = \'same page\'' })

    // Picking that tab in the main window draws the card, not a second page; Show Here moves it.
    expect((await browser.act({ action: 'press', target: 'today-beta' })).ok).toBe(true)
    await settle()
    expect((await browser.act({ action: 'press', target: 'show-here', window: second })).error).toContain('No control')
    expect((await browser.act({ action: 'press', target: 'show-here' })).ok).toBe(true)
    await settle(1500)
    expect((await browser.act({ action: 'press', target: 'show-here', window: second })).ok).toBe(true)
    await settle(1500)

    // Moved there and back, never made again; one page on screen, the main window drawing the card.
    expect((await browser.act({ action: 'web', tab: 'beta', js: 'window.__moved' })).value).toBe('same page')
    const state = browser.state()
    expect(state.windows.flatMap(window => window.errors)).toEqual([])
    expect(state.webViews).toBe(1)
  }, 60_000)

  it('opens a link from a pinned tab to another site in Peek, and keeps it as a tab', async () => {
    browser = await openBrowser(seeded)
    await browser.act({ action: 'press', target: 'pinned-docs' })
    await settle(1500)
    const elsewhere = browser.page('gamma', 'localhost')
    await browser.act({ action: 'web', tab: 'docs', js: `(() => { const a = document.createElement('a'); a.href = ${JSON.stringify(elsewhere)}; a.target = '_blank'; document.body.appendChild(a); a.click(); return 'clicked' })()` })
    await settle(2000)
    // The pinned tab stayed where it was; Peek holds the other site.
    expect(await location('docs')).toBe('/fixture/docs')
    expect((await browser.act({ action: 'press', target: 'peek-keep' })).ok).toBe(true)
    await settle(1200)
    expect((await browser.act({ action: 'press', target: 'peek-keep' })).error).toContain('No control')
    expect(browser.state().windows.flatMap(window => window.errors)).toEqual([])
  }, 60_000)

  it('hides a zapped element for good', async () => {
    browser = await openBrowser(seeded)
    await browser.act({ action: 'command', id: 'site-controls' })
    await settle(500)
    expect((await browser.act({ action: 'press', target: 'site-boost' })).ok).toBe(true)
    await settle()
    expect((await browser.act({ action: 'press', target: 'boost-zap' })).ok).toBe(true)
    await settle()
    await browser.act({ action: 'web', tab: 'alpha', js: 'document.querySelector(\'.ad\').click()' })
    await settle(1200)
    await browser.act({ action: 'press', target: 'boost-zap' })
    await settle(1500)
    await browser.act({ action: 'command', id: 'escape' })
    await browser.act({ action: 'command', id: 'reload' })
    await settle(2000)
    expect((await browser.act({ action: 'web', tab: 'alpha', js: 'getComputedStyle(document.querySelector(\'.ad\')).display' })).value).toBe('none')
  }, 60_000)

  it('blocks with very-good-adblock\'s rules, answers its content script, and stays off a site the person allowed', async () => {
    browser = await openBrowser(seeded, { blocker: true })
    const adShown = async () => (await browser!.act({ action: 'web', tab: 'alpha', js: 'getComputedStyle(document.querySelector(\'ins.adsbygoogle\')).display' })).value
    // The first launch compiles the lists, then the page loads under them.
    await browser.act({ action: 'command', id: 'reload' })
    await settle(3000)
    expect(await adShown()).toBe('none')

    // The content script asked the browser for its settings and reported what it hid, both over its bridge.
    await browser.act({ action: 'command', id: 'site-controls' })
    await settle(500)
    expect(browser.text('site-blocked-count')).toMatch(/^\d+ ads? hidden on this page$/)

    // Allowed: no list applies, and the content script, told so in its settings, hides nothing.
    expect((await browser.act({ action: 'press', target: 'site-blocking' })).ok).toBe(true)
    await settle(3000)
    expect(await adShown()).toBe('block')
    expect(browser.state().windows.flatMap(window => window.errors)).toEqual([])
  }, 60_000)
})
