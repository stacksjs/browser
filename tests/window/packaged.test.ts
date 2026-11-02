import { afterAll, describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * The agent as it ships: the launcher `buddy build:desktop` compiled into
 * Browser.app, serving from the bundle's Resources. Routes run from source in
 * every other test, where a package can read files beside its own modules; a
 * compiled agent has no node_modules, so only this catches a route that needs
 * one (very-good-adblock's rule lists did).
 *
 * The window is a stand-in that only waits, and HOME is a scratch folder, so
 * the person's own app, its data and its settings are never touched.
 */

const APP = join(import.meta.dir, '../../storage/framework/desktop/macos/Browser.app')
const enabled = process.env.BROWSER_WINDOW_TESTS === '1' && existsSync(join(APP, 'Contents/MacOS/Browser'))
const scratch = mkdtempSync(join(tmpdir(), 'browser-packaged-'))
let launcher: ReturnType<typeof Bun.spawn> | undefined

afterAll(() => {
  launcher?.kill()
  rmSync(scratch, { recursive: true, force: true })
})

/** The bundle's manifest with every path absolute, and a host that only waits. */
function standInManifest(): string {
  const resources = join(APP, 'Contents/Resources')
  const manifest = JSON.parse(readFileSync(join(resources, 'desktop-agent.json'), 'utf8'))
  const at = (path: string) => isAbsolute(path) ? path : resolve(resources, path)
  const host = join(scratch, 'host')
  writeFileSync(host, '#!/bin/sh\nexec sleep 60\n')
  chmodSync(host, 0o755)
  const file = join(scratch, 'desktop-agent.json')
  writeFileSync(file, JSON.stringify({
    ...manifest,
    host,
    nativeBundle: at(manifest.nativeBundle),
    ...(manifest.staticDir ? { staticDir: at(manifest.staticDir) } : {}),
    ...(manifest.resources ? { resources: Object.fromEntries(Object.entries(manifest.resources as Record<string, string>).map(([name, path]) => [name, at(path)])) } : {}),
  }))
  return file
}

async function agentUrl(): Promise<string> {
  const portFile = join(scratch, 'Library/Application Support/Browser/agent.port')
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(portFile)) {
      const url = `http://127.0.0.1:${readFileSync(portFile, 'utf8').trim()}`
      try {
        if ((await fetch(`${url}/native/session`)).ok) return url
      }
      catch {}
    }
    await Bun.sleep(100)
  }
  throw new Error(`The built agent never answered; its log: ${join(scratch, 'Library/Logs/Browser.log')}`)
}

describe.skipIf(!enabled)('the built app\'s own agent', () => {
  it('serves very-good-adblock\'s rule lists and scripts from inside the bundle', async () => {
    launcher = Bun.spawn([join(APP, 'Contents/MacOS/Browser')], {
      env: { ...process.env, HOME: scratch, STACKS_DESKTOP_AGENT_MANIFEST: standInManifest() },
      stdout: 'ignore',
      stderr: 'ignore',
    })
    const url = await agentUrl()
    const cookie = ((await fetch(`${url}/native/session`)).headers.get('set-cookie') ?? '').split(';')[0]!
    const response = await fetch(`${url}/api/blocker`, { headers: { cookie } })
    const log = existsSync(join(scratch, 'Library/Logs/Browser.log')) ? readFileSync(join(scratch, 'Library/Logs/Browser.log'), 'utf8') : ''
    expect({ status: response.status, log: log.split('\n').filter(line => line.includes('ERROR')).join('\n') }).toEqual({ status: 200, log: '' })
    const manifest = await response.json() as { lists: Array<{ identifier: string }>, scripts: Array<{ js: string }> }
    expect(manifest.lists.length).toBeGreaterThan(0)
    expect(manifest.scripts.every(script => script.js.length > 0)).toBe(true)

    const first = manifest.lists[0]!.identifier
    const rules = await fetch(`${url}/api/blocker/list?id=${encodeURIComponent(first)}`, { headers: { cookie } })
    expect(rules.status).toBe(200)
    expect((await rules.json() as unknown[]).length).toBeGreaterThan(0)
  }, 30_000)
})
