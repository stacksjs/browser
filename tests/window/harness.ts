import type { Database } from 'bun:sqlite'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boostsApi, createBoosts } from '../../app/Desktop/boosts'
import { openBrowserDatabase } from '../../app/Desktop/database'
import { createDownloads } from '../../app/Desktop/downloads'
import { downloadsApi } from '../../app/Desktop/downloads-api'
import { createHistory } from '../../app/Desktop/history'
import { historyApi } from '../../app/Desktop/history-api'
import { createSession } from '../../app/Desktop/session'
import { sessionApi } from '../../app/Desktop/session-api'
import { createSites, sitesApi } from '../../app/Desktop/sites'
import { createSuggestions, suggestApi } from '../../app/Desktop/suggest'
import { diffSession } from '../../resources/functions/browser/session'
import type { BrowserState } from '../../resources/functions/browser/sidebar'

/**
 * The real window, driven. The Craft host `buddy build:desktop` built (with its
 * screen bundle), the agent's own stores over a scratch database, local fixture
 * pages, and the host's --test-dir driver, which acts on native controls by
 * test ID (`press`, `type`, `submit`, `command`) and on pages with `web`.
 *
 * The host is the bare binary, not the app bundle, so the person's own app keeps
 * its settings; the bare host's settings are saved first and put back after.
 */

const ROOT = join(import.meta.dir, '../..')
/** The UserDefaults domain of the bare host binary (craft.storage keys are prefixed `craft.native.`). */
const DOMAIN = 'craft-native-macos'

/** The newest host build with its screen bundle, or null before `buddy build:desktop` has run. */
export function builtHost(): { host: string, bundle: string } | null {
  const builds = join(ROOT, 'storage/framework/desktop/host')
  if (!existsSync(builds)) return null
  const newest = readdirSync(builds)
    .map(name => join(builds, name))
    .filter(dir => existsSync(join(dir, 'craft-native-macos')) && existsSync(join(dir, 'native-screen.js')))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  return newest ? { host: join(newest, 'craft-native-macos'), bundle: join(newest, 'native-screen.js') } : null
}

export type Action = Record<string, unknown> & { action: string, window?: string }
export interface Result { ok?: boolean, value?: string, error?: string, path?: string }

export interface Browser {
  /** Fixture page `name` on the local server; `host` swaps 127.0.0.1 for another site (`localhost`). */
  page: (name: string, host?: string) => string
  act: (action: Action) => Promise<Result>
  /** The name of the window whose name starts with `prefix` (`window-`, `private-`). */
  window: (prefix: string) => string | undefined
  state: () => { windows: Array<{ name: string, errors: string[] }>, webViews: number }
  close: () => Promise<void>
}

function fixturePage(name: string): Response {
  return new Response(`<!doctype html><title>${name[0]!.toUpperCase()}${name.slice(1)} page</title><body style="font:20px -apple-system;padding:30px"><h1>${name}</h1><a href="/fixture/beta" target="_blank">new tab</a><div class="ad" style="background:red;color:white;padding:20px">AD</div></body>`, { headers: { 'content-type': 'text/html' } })
}

/** The agent's routes over `db`, with search suggestions stood in for so nothing leaves the machine. */
function serveAgent(db: Database) {
  const session = sessionApi(() => createSession(db))
  const history = historyApi(() => createHistory(db))
  const suggest = suggestApi(createSuggestions({ fetch: async url => Response.json([url, []]) }))
  const sites = sitesApi(() => createSites(db))
  const boosts = boostsApi(() => createBoosts(db))
  const downloads = downloadsApi(() => createDownloads(db))
  return Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const { pathname } = new URL(request.url)
      const method = request.method
      const fixture = /^\/fixture\/([\w-]+)$/.exec(pathname)
      if (fixture) return fixturePage(fixture[1]!)
      if (pathname === '/api/session') return method === 'PUT' ? session.save(request) : session.load()
      if (pathname === '/api/session/archive') return session.archived(request)
      if (pathname === '/api/history') return method === 'POST' ? history.record(request) : method === 'DELETE' ? history.forget(request) : history.search(request)
      if (pathname === '/api/suggest') return suggest.get(request)
      if (pathname === '/api/sites') return method === 'PUT' ? sites.save(request) : sites.all()
      if (pathname === '/api/boosts') return method === 'PUT' ? boosts.save(request) : method === 'DELETE' ? boosts.remove(request) : boosts.all()
      if (pathname === '/api/downloads') return method === 'POST' ? downloads.record(request) : method === 'DELETE' ? downloads.clear() : downloads.list(request)
      // The blocker starts with no lists: these tests are about windows, not rules.
      if (pathname === '/api/blocker') return Response.json({ lists: [], scripts: [] })
      if (pathname === '/api/import/arc') return Response.json({ data: { found: false } })
      return new Response(null, { status: 404 })
    },
  })
}

const run = async (command: string[]) => { await Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' }).exited }

/** Opens the browser over a sidebar `seed` builds from fixture page addresses. */
export async function openBrowser(seed: (page: (name: string) => string) => BrowserState): Promise<Browser> {
  const built = builtHost()
  if (!built) throw new Error('No host build: run `./buddy build:desktop` first.')
  const temp = mkdtempSync(join(tmpdir(), 'browser-window-test-'))
  const settings = join(temp, 'defaults.plist')
  await run(['defaults', 'export', DOMAIN, settings])
  await run(['defaults', 'delete', DOMAIN])
  await run(['defaults', 'write', DOMAIN, 'craft.native.browser.onboarded', '-bool', 'true'])

  const db = openBrowserDatabase(join(temp, 'Browser.sqlite'))
  const server = serveAgent(db)
  const page = (name: string, host = '127.0.0.1') => `http://${host}:${server.port}/fixture/${name}`
  createSession(db).save(diffSession(null, seed(name => page(name)))!)

  const test = join(temp, 'test')
  const host = Bun.spawn([built.host, '--no-session', '--api-url', `http://127.0.0.1:${server.port}`, '--native-bundle', built.bundle, '--title', 'Browser', '--titlebar-style', 'transparent', '--traffic-lights', '18,15', '--width', '1200', '--height', '800', '--test-dir', test], { stdout: 'ignore', stderr: 'ignore' })
  const deadline = Date.now() + 20_000
  while (!existsSync(join(test, 'state.json'))) {
    if (Date.now() > deadline) throw new Error('The host did not start')
    await Bun.sleep(50)
  }
  // The screen restores the sidebar and shows its first page.
  await Bun.sleep(2500)

  const state = () => JSON.parse(readFileSync(join(test, 'state.json'), 'utf8'))
  let count = 0
  return {
    page,
    state,
    window: prefix => (state().windows as Array<{ name: string }>).map(each => each.name).find(name => name.startsWith(prefix)),
    async act(action) {
      const name = `action-${String(++count).padStart(3, '0')}.json`
      writeFileSync(join(test, name), JSON.stringify(action))
      const answer = join(test, name.replace('action-', 'result-'))
      const until = Date.now() + 10_000
      while (!existsSync(answer)) {
        if (Date.now() > until) return { ok: false, error: 'The host did not answer' }
        await Bun.sleep(25)
      }
      return JSON.parse(readFileSync(answer, 'utf8')) as Result
    },
    async close() {
      host.kill()
      await host.exited
      server.stop(true)
      db.close()
      await run(['defaults', 'delete', DOMAIN])
      if (existsSync(settings)) await run(['defaults', 'import', DOMAIN, settings])
      rmSync(temp, { recursive: true, force: true })
    },
  }
}

/** Waits for the screen to settle after an action. */
export const settle = (ms = 800) => Bun.sleep(ms)
