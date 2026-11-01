import { describe, expect, it } from 'bun:test'
import { blockerApi } from '../../../app/Desktop/blocker'

// The real library, through the agent's own routes: what the window compiles is
// what very-good-adblock ships, so a list WebKit would refuse fails here first.
const routes = blockerApi(() => import('very-good-adblock'))
const get = (path: string) => new Request(`http://127.0.0.1${path}`)

describe('the blocker routes', () => {
  it('list every rule list by version, with the page scripts', async () => {
    const manifest = await (await routes.manifest(get('/api/blocker'))).json() as { lists: Array<{ identifier: string, version: string }>, scripts: Array<{ id: string, hosts: string[], js: string }> }

    expect(manifest.lists.length).toBeGreaterThan(0)
    for (const list of manifest.lists) {
      expect(list.identifier).toStartWith('very-good-adblock-')
      expect(list.version).toBeTruthy()
    }
    expect(manifest.scripts.map(script => script.id)).toContain('yt-inpage')
    for (const script of manifest.scripts)
      expect(script.js.length).toBeGreaterThan(0)
  })

  it('serve each list as WebKit content-blocker JSON under its rule cap', async () => {
    const manifest = await (await routes.manifest(get('/api/blocker'))).json() as { lists: Array<{ identifier: string }> }

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

  it('add the cookie-banner rules only when asked', async () => {
    const count = async (query: string) => {
      const manifest = await (await routes.manifest(get(`/api/blocker${query}`))).json() as { lists: Array<{ identifier: string }> }
      let total = 0
      for (const { identifier } of manifest.lists)
        total += (await (await routes.list(get(`/api/blocker/list?id=${identifier}${query.replace('?', '&')}`))).json() as unknown[]).length
      return total
    }

    expect(await count('?cookieConsent=1')).toBeGreaterThan(await count(''))
  })

  it('answer 404 for a list it does not have', async () => {
    expect((await routes.list(get('/api/blocker/list?id=nope'))).status).toBe(404)
  })
})
