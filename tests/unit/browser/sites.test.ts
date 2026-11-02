import { afterEach, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { releaseOrm } from '@stacksjs/query-builder'
import { openBrowserDatabase } from '../../../app/Desktop/database'
import { createSites, siteSettingsFrom, sitesApi } from '../../../app/Desktop/sites'
import type { UserScript } from '../../../resources/functions/browser/blocker'
import { createBlocker } from '../../../resources/functions/browser/blocker'
import { createSitesClient, decide, defaultSettings, remember, siteKey, stepZoom, unblockedHosts } from '../../../resources/functions/browser/sites'

const open: Database[] = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  releaseOrm()
})

describe('site settings', () => {
  it('name a site by its host without www, and only for web pages', () => {
    expect(siteKey('https://www.YouTube.com/watch?v=1')).toBe('youtube.com')
    expect(siteKey('http://127.0.0.1:3000/')).toBe('127.0.0.1')
    expect(siteKey('about:blank')).toBeNull()
    expect(siteKey('not a url')).toBeNull()
  })

  it('answer device requests from what was remembered, and remember new answers', () => {
    const site = defaultSettings('meet.example')
    expect(decide(site, 'camera')).toBe('ask')
    const camera = remember(site, 'camera', 'allow')
    expect(decide(camera, 'camera')).toBe('allow')
    expect(decide(camera, 'camera+microphone')).toBe('ask')
    expect(decide(remember(camera, 'microphone', 'deny'), 'camera+microphone')).toBe('deny')
    expect(decide(remember(site, 'camera+microphone', 'allow'), 'camera+microphone')).toBe('allow')
  })

  it('zoom in Safari\'s steps, stopping at either end', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.05, -1)).toBe(1)
    expect(stepZoom(3, 1)).toBe(3)
    expect(stepZoom(0.5, -1)).toBe(0.5)
  })

  it('are kept by the agent, and a site back at its defaults is forgotten', async () => {
    const db = openBrowserDatabase(':memory:')
    open.push(db)
    const sites = createSites(db)
    const routes = sitesApi(() => sites)
    const put = (body: unknown) => routes.save(new Request('http://x/api/sites', { method: 'PUT', body: JSON.stringify(body) }))
    expect((await put({ ...defaultSettings('ads.example'), blocking: false })).status).toBe(204)
    expect((await put({ ...defaultSettings('zoom.example'), zoom: 1.25 })).status).toBe(204)
    const all = (await routes.all().json() as { data: Record<string, any> }).data
    expect(Object.keys(all).sort()).toEqual(['ads.example', 'zoom.example'])
    expect(unblockedHosts(all)).toEqual(['ads.example'])
    await put(defaultSettings('ads.example'))
    expect(Object.keys(sites.all())).toEqual(['zoom.example'])
    expect(siteSettingsFrom({ ...defaultSettings('x.com'), camera: 'always' })).toBeNull()
    expect((await put({ host: 'Bad Host!' })).status).toBe(422)
    const client = createSitesClient({ base: '', fetch: async (url, init) => (init?.method === 'PUT' ? routes.save(new Request(`http://x${url}`, init)) : routes.all()) })
    await client.save({ ...defaultSettings('meet.example'), camera: 'allow' })
    expect((await client.all())['meet.example']!.camera).toBe('allow')
  })
})

describe('the blocker in the window', () => {
  function fakeWeb() {
    const compiled = new Map<string, string>()
    const calls: string[] = []
    let scripts: UserScript[] = []
    let allowed: string[] = []
    const bridges: string[] = []
    return {
      compiled, calls, scripts: () => scripts, allowed: () => allowed, bridges,
      web: {
        async setContentRules(identifier: string, list: { version: string, json?: string }) {
          const key = `${identifier}@${list.version}`
          calls.push(`set ${key}${list.json ? ' +json' : ''}`)
          if (list.json) { compiled.set(key, list.json); return { cached: false } }
          return compiled.has(key) ? { cached: true } : { missing: true }
        },
        async removeContentRules(identifier: string) { calls.push(`remove ${identifier}`) },
        async allowContent(hosts: string[]) { allowed = hosts },
        async setUserScripts(next: UserScript[]) { scripts = next },
        onBridge(handler: string) { bridges.push(handler); return () => {} },
      },
    }
  }
  function agent(lists: Array<{ identifier: string, version: string }>) {
    const sent: string[] = []
    const fetch = async (url: string) => {
      sent.push(url)
      if (url.startsWith('/api/blocker/list')) return new Response('[{"trigger":{"url-filter":".*"},"action":{"type":"block"}}]')
      return Response.json({ lists, scripts: [
        { id: 'yt-inpage', hosts: ['youtube.com'], world: 'page', at: 'start', allFrames: false, js: 'yt()' },
        { id: 'popup-guard', hosts: [], world: 'page', at: 'start', allFrames: true, js: 'guard()' },
        { id: 'content', hosts: [], world: 'isolated', at: 'start', allFrames: false, bridge: 'vgab', js: 'content()' },
      ] })
    }
    return { sent, fetch }
  }

  it('sends the rules only for lists WebKit never compiled, and drops lists that went away', async () => {
    const fake = fakeWeb()
    const first = agent([{ identifier: 'vgab-1', version: 'a' }, { identifier: 'vgab-2', version: 'b' }])
    const blocker = createBlocker({ base: '', web: fake.web, fetch: first.fetch })
    expect(await blocker.sync()).toEqual({ lists: 2, compiled: 2 })
    const again = createBlocker({ base: '', web: fake.web, fetch: agent([{ identifier: 'vgab-1', version: 'a' }]).fetch })
    expect(await again.sync()).toEqual({ lists: 1, compiled: 0 })
    const later = agent([{ identifier: 'vgab-1', version: 'c' }])
    const blocker2 = createBlocker({ base: '', web: fake.web, fetch: later.fetch })
    await blocker2.sync()
    await (blocker2 as any).sync()
    expect(later.sent.filter(url => url.startsWith('/api/blocker/list'))).toHaveLength(1)
    expect(fake.scripts().map(script => `${script.id}:${script.world}:${script.at}:${script.bridge ?? ''}`)).toEqual(['blocker:yt-inpage:page:start:', 'blocker:popup-guard:page:start:', 'blocker:content:isolated:start:vgab'])
    // Each blocker answers its scripts' bridge once, however often it syncs.
    expect(fake.bridges).toEqual(['vgab', 'vgab', 'vgab'])
  })

  it('stays out of allowed sites, can be turned off, and keeps Boosts beside it', async () => {
    const fake = fakeWeb()
    const blocker = createBlocker({ base: '', web: fake.web, fetch: agent([{ identifier: 'vgab-1', version: 'a' }]).fetch })
    await blocker.sync()
    await blocker.setBoosts([{ id: 'boost:x', hosts: ['x.com'], css: 'a{}' }])
    await blocker.allow(['youtube.com'])
    expect(fake.allowed()).toEqual(['youtube.com'])
    expect(fake.scripts().map(script => script.id)).toEqual(['blocker:popup-guard', 'blocker:content', 'boost:x'])
    await blocker.setEnabled(false)
    expect(fake.calls.at(-1)).toBe('remove vgab-1')
    expect(fake.scripts().map(script => script.id)).toEqual(['boost:x'])
  })

  it('answers its content script with the browser\'s settings, as the extension\'s background page would', async () => {
    const blocker = createBlocker({ base: '', web: fakeWeb().web, fetch: agent([{ identifier: 'vgab-1', version: 'a' }]).fetch })
    await blocker.sync({ cookieConsent: true })
    await blocker.allow(['example.org'])
    const ask = (body: unknown, url = 'https://news.example/') => blocker.answer({ tab: 't1', url, body })
    const sent = (message: unknown, url?: string) => ask({ v: 1, api: 'runtime.sendMessage', payload: { message } }, url)

    expect(sent({ type: 'get-dashboard' })).toEqual({ ok: true, data: { settings: {
      enabled: true, cosmeticFiltering: true, aggressiveCosmetic: false, cookieConsentFiltering: true, popupBlocking: true,
      youtubeEnhancements: true, twitchEnhancements: true, allowedSites: ['example.org'], blockedSites: [],
    } } })
    await blocker.setEnabled(false)
    expect((sent({ type: 'get-dashboard' }) as any).data.settings.enabled).toBe(false)
    expect(sent({ type: 'export-data' })).toEqual({ ok: false, error: 'The browser does not answer export-data' })
    expect(() => ask({ v: 1, api: 'tabs.query', payload: {} })).toThrow('The browser does not answer tabs.query')
  })

  it('counts what each tab\'s page hid, never on an allowed site or with blocking off, and starts over on a new page', async () => {
    const heard: string[] = []
    const blocker = createBlocker({ base: '', web: fakeWeb().web, fetch: agent([{ identifier: 'vgab-1', version: 'a' }]).fetch, onBlocked: (tab, count) => heard.push(`${tab}:${count}`) })
    await blocker.sync()
    await blocker.allow(['example.org'])
    const report = (tab: string, url: string, counts: unknown[]) => blocker.answer({ tab, url, body: { v: 1, api: 'runtime.sendMessage', payload: { message: { type: 'record-blocks', events: counts.map(count => ({ count })) } } } })

    expect(report('t1', 'https://news.example/a', [2, 3])).toEqual({ ok: true, data: true })
    report('t1', 'https://news.example/a', [1, -4, 'x'])
    report('t2', 'https://www.example.org/', [5])
    expect([blocker.blocked('t1'), blocker.blocked('t2')]).toEqual([6, 0])
    expect(heard).toEqual(['t1:5', 't1:6'])
    blocker.newPage('t1')
    expect(blocker.blocked('t1')).toBe(0)
    await blocker.setEnabled(false)
    report('t1', 'https://news.example/b', [9])
    expect(blocker.blocked('t1')).toBe(0)
  })

  it('keeps the content script\'s storage for the run, per area', () => {
    const blocker = createBlocker({ base: '', web: fakeWeb().web })
    const storage = (api: string, payload: unknown) => blocker.answer({ tab: 't1', url: 'https://a.example/', body: { v: 1, api, payload } })
    expect(storage('storage.set', { area: 'local', items: { a: 1, b: 2 } })).toBeNull()
    storage('storage.set', { area: 'session', items: { a: 'session' } })
    expect(storage('storage.get', { area: 'local', keys: null })).toEqual({ a: 1, b: 2 })
    expect(storage('storage.get', { area: 'local', keys: 'a' })).toEqual({ a: 1 })
    expect(storage('storage.get', { area: 'local', keys: { b: 0, c: 0 } })).toEqual({ b: 2 })
    storage('storage.remove', { area: 'local', keys: ['a'] })
    expect(storage('storage.get', { area: 'local', keys: ['a', 'b'] })).toEqual({ b: 2 })
    storage('storage.clear', { area: 'local' })
    expect(storage('storage.get', { area: 'local', keys: null })).toEqual({})
    expect(storage('storage.get', { area: 'session', keys: null })).toEqual({ a: 'session' })
  })
})
