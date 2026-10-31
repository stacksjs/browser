/**
 * The ad blocker in the window: very-good-adblock's lists and page scripts,
 * served by the agent (app/Desktop/blocker.ts), handed to WebKit through
 * `craft.web`. WebKit keeps compiled lists by version, so a launch costs one
 * small request per list; the rules themselves cross only when they changed.
 */

export interface BlockerList { identifier: string, version: string }
export interface PageScript { id: string, hosts: string[], allFrames: boolean, js: string }
export interface UserScript { id: string, hosts: string[], css?: string, js?: string, world?: 'isolated' | 'page', at?: 'start' | 'end', allFrames?: boolean }

/** The part of `craft.web` the blocker uses. */
export interface BlockerWeb {
  setContentRules: (identifier: string, list: { version: string, json?: string }) => Promise<{ missing?: boolean, cached?: boolean }>
  removeContentRules: (identifier: string) => Promise<unknown>
  allowContent: (hosts: string[]) => Promise<unknown>
  setUserScripts: (scripts: UserScript[]) => Promise<unknown>
}

export interface BlockerOptions {
  base: string
  web: BlockerWeb
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

export interface Blocker {
  /** Compile what changed and drop lists that went away. Resolves how many lists WebKit had to compile. */
  sync: (options?: { cookieConsent?: boolean }) => Promise<{ lists: number, compiled: number }>
  /** Turn blocking off everywhere, or back on. */
  setEnabled: (enabled: boolean, options?: { cookieConsent?: boolean }) => Promise<void>
  /** Sites (and their subdomains) where the blocker stays out of the way. */
  allow: (hosts: string[]) => Promise<void>
  /** The person's own scripts (Boosts), installed beside the blocker's. */
  setBoosts: (boosts: UserScript[]) => Promise<void>
}

export function createBlocker(options: BlockerOptions): Blocker {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  const web = options.web
  let installed: string[] = []
  let pageScripts: PageScript[] = []
  let boosts: UserScript[] = []
  let allowed: string[] = []
  let enabled = true

  const covers = (hosts: string[], host: string) => hosts.some(each => host === each || host.endsWith(`.${each}`))
  /** A page script for a site the person allowed stays out too; one for every site cannot be told apart. */
  function scripts(): UserScript[] {
    const blocking = enabled ? pageScripts.filter(script => !script.hosts.length || !script.hosts.every(host => covers(allowed, host))) : []
    return [
      ...blocking.map(script => ({ id: `blocker:${script.id}`, hosts: script.hosts, js: script.js, world: 'page' as const, at: 'start' as const, allFrames: script.allFrames })),
      ...boosts,
    ]
  }

  async function sync(syncOptions: { cookieConsent?: boolean } = {}) {
    const query = syncOptions.cookieConsent ? '?cookieConsent=1' : ''
    const response = await send(`${base}/api/blocker${query}`)
    if (!response.ok) throw new Error(`The agent has no blocker lists (${response.status})`)
    const manifest = await response.json() as { lists: BlockerList[], scripts: PageScript[] }
    let compiled = 0
    for (const list of manifest.lists) {
      const answer = await web.setContentRules(list.identifier, { version: list.version })
      if (!answer.missing) continue
      const rules = await send(`${base}/api/blocker/list?id=${encodeURIComponent(list.identifier)}${syncOptions.cookieConsent ? '&cookieConsent=1' : ''}`)
      if (!rules.ok) throw new Error(`The agent could not send ${list.identifier} (${rules.status})`)
      await web.setContentRules(list.identifier, { version: list.version, json: await rules.text() })
      compiled++
    }
    const current = manifest.lists.map(list => list.identifier)
    for (const gone of installed.filter(identifier => !current.includes(identifier))) await web.removeContentRules(gone)
    installed = current
    pageScripts = manifest.scripts
    await web.setUserScripts(scripts())
    return { lists: current.length, compiled }
  }

  return {
    sync,
    async setEnabled(next, syncOptions) {
      enabled = next
      if (next) { await sync(syncOptions); return }
      for (const identifier of installed) await web.removeContentRules(identifier)
      installed = []
      await web.setUserScripts(scripts())
    },
    async allow(hosts) {
      allowed = [...hosts]
      await web.allowContent(allowed)
      await web.setUserScripts(scripts())
    },
    async setBoosts(next) {
      boosts = next
      await web.setUserScripts(scripts())
    },
  }
}
