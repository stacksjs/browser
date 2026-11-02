import { describe, expect, it } from 'bun:test'
import { blockerApi, CONSENT_GROUP, matchedHosts, pageScript } from '../../../app/Desktop/blocker'

// The real library, through the agent's own routes: what the window compiles is
// what very-good-adblock ships, so a list WebKit would refuse fails here first.
const routes = blockerApi(() => import('very-good-adblock'))
const get = (path: string) => new Request(`http://127.0.0.1${path}`)

interface Manifest {
  lists: Array<{ identifier: string, version: string }>
  scripts: Array<{ id: string, hosts: string[], world: string, at: string, allFrames: boolean, bridge?: string, js: string }>
  bridge: string
}

describe('the blocker routes', () => {
  it('list every enabled rule list by version, with the scripts and the bridge they post to', async () => {
    const manifest = await (await routes.manifest(get('/api/blocker'))).json() as Manifest

    expect(manifest.lists.length).toBeGreaterThan(0)
    for (const list of manifest.lists) {
      expect(list.identifier).toStartWith('very_good_adblock_')
      expect(list.version).toBeTruthy()
    }
    expect(manifest.lists.map(list => list.identifier)).not.toContain(CONSENT_GROUP)
    expect(manifest.bridge).toBe('very-good-adblock')
    const byId = Object.fromEntries(manifest.scripts.map(script => [script.id, script]))
    expect(byId['yt-inpage']).toMatchObject({ hosts: ['youtube.com', 'youtube-nocookie.com'], world: 'page', at: 'start' })
    // The content script runs everywhere, in its own world, and is the one that asks the browser for its settings.
    expect(byId.content).toMatchObject({ hosts: [], world: 'isolated', bridge: 'very-good-adblock' })
    expect(byId['popup-guard']).toMatchObject({ hosts: [], world: 'page', allFrames: true })
    expect(byId['popup-guard'].bridge).toBeUndefined()
    for (const script of manifest.scripts)
      expect(script.js.length).toBeGreaterThan(0)
  })

  it('serve each list as WebKit content-blocker JSON under its rule cap', async () => {
    const manifest = await (await routes.manifest(get('/api/blocker'))).json() as Manifest

    for (const { identifier } of manifest.lists) {
      const rules = await (await routes.list(get(`/api/blocker/list?id=${identifier}`))).json() as Array<{ trigger: { 'url-filter': string }, action: { type: string } }>
      expect(rules.length).toBeGreaterThan(0)
      expect(rules.length).toBeLessThanOrEqual(150_000)
      for (const rule of rules.slice(0, 500)) {
        expect(() => new RegExp(rule.trigger['url-filter'])).not.toThrow()
        expect(rule.action.type).toBeTruthy()
      }
    }
  })

  it('add the cookie-banner list only when asked, and leave the other off-by-default lists off', async () => {
    const ids = async (query: string) => ((await (await routes.manifest(get(`/api/blocker${query}`))).json()) as Manifest).lists.map(list => list.identifier)
    const plain = await ids('')
    const consent = await ids('?cookieConsent=1')

    expect(consent).toEqual([...plain, CONSENT_GROUP])
    expect(consent).not.toContain('very_good_adblock_cosmetic_aggressive')
    expect((await routes.list(get(`/api/blocker/list?id=${CONSENT_GROUP}`))).status).toBe(404)
    expect((await routes.list(get(`/api/blocker/list?id=${CONSENT_GROUP}&cookieConsent=1`))).status).toBe(200)
  })

  it('answer 404 for a list it does not have', async () => {
    expect((await routes.list(get('/api/blocker/list?id=nope'))).status).toBe(404)
  })
})

describe('scripts for a host-only user script', () => {
  it('reads extension match patterns as hosts with their subdomains', () => {
    expect(matchedHosts(['*://x.com/*', '*://*.x.com/*', 'https://*.Twitter.com/home*'])).toEqual(['x.com', 'twitter.com'])
    expect(matchedHosts(['http://*/*', 'https://*/*'])).toEqual([])
    expect(matchedHosts(['<all_urls>'])).toEqual([])
    expect(matchedHosts(['*://a.example/*', '*://*/*'])).toEqual([])
    expect(matchedHosts(['file:///*'])).toBeUndefined()
    expect(matchedHosts([])).toBeUndefined()
  })

  it('drops a script that runs on no web page, rather than running it everywhere', () => {
    const script = { id: 's', matches: ['file:///*'], runAt: 'document-end' as const, allFrames: false, world: 'page' as const, bridged: false, source: 's()' }
    expect(pageScript(script, 'h')).toBeUndefined()
    expect(pageScript({ ...script, matches: ['*://a.example/*'], bridged: true }, 'h')).toEqual({ id: 's', hosts: ['a.example'], world: 'page', at: 'end', allFrames: false, bridge: 'h', js: 's()' })
  })
})
