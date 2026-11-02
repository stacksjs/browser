/**
 * The ad blocker in the window: very-good-adblock's lists and scripts, served
 * by the agent (app/Desktop/blocker.ts), handed to WebKit through `craft.web`.
 * WebKit keeps compiled lists by version, so a launch costs one small request
 * per list; the rules themselves cross only when they changed.
 *
 * The extension's content script asks its background page for the settings
 * and reports what it hid. Here that page is this module: it answers on the
 * script's bridge (`web.onBridge`) with the browser's own settings, so the
 * off switch and allowed sites reach every script, and counts what each tab's
 * page hid.
 */

export interface BlockerList { identifier: string, version: string }
/** A blocker script as the agent serves it: the hosts it runs on (none is every site) and the handler it posts to. */
export interface PageScript { id: string, hosts: string[], world: 'page' | 'isolated', at: 'start' | 'end', allFrames: boolean, bridge?: string, js: string }
export interface UserScript { id: string, hosts: string[], css?: string, js?: string, world?: 'isolated' | 'page', at?: 'start' | 'end', allFrames?: boolean, bridge?: string }
/** What a bridged script posted, as `craft.web.onBridge` hands it over. */
export interface BridgeMessage { tab: string, url: string, body: unknown }

/** The part of `craft.web` the blocker uses. */
export interface BlockerWeb {
  setContentRules: (identifier: string, list: { version: string, json?: string }) => Promise<{ missing?: boolean, cached?: boolean }>
  removeContentRules: (identifier: string) => Promise<unknown>
  allowContent: (hosts: string[]) => Promise<unknown>
  setUserScripts: (scripts: UserScript[]) => Promise<unknown>
  onBridge: (handler: string, answer: (message: BridgeMessage) => unknown) => () => void
}

export interface BlockerOptions {
  base: string
  web: BlockerWeb
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** A tab's page hid more ads: its count so far. */
  onBlocked?: (tab: string, count: number) => void
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
  /** What the blocker's scripts post on its bridge: the answer resolves their post, a throw rejects it. */
  answer: (message: BridgeMessage) => unknown
  /** How many ads the page in `tab` hid. */
  blocked: (tab: string) => number
  /** The tab started another page, or closed: its count starts over. */
  newPage: (tab: string) => void
}

const covers = (hosts: string[], host: string) => hosts.some(each => host === each || host.endsWith(`.${each}`))
const hostOf = (url: string) => { try { return new URL(url).hostname.toLowerCase() } catch { return '' } }

export function createBlocker(options: BlockerOptions): Blocker {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  const web = options.web
  let installed: string[] = []
  let pageScripts: PageScript[] = []
  let boosts: UserScript[] = []
  let allowed: string[] = []
  let enabled = true
  let cookieConsent = false
  const counts = new Map<string, number>()
  const bridges = new Set<string>()
  // The extension's storage, which its content script may use; it lasts the run.
  const storage: Record<'local' | 'sync' | 'session', Record<string, unknown>> = { local: {}, sync: {}, session: {} }

  /** A script for a site the person allowed stays out too; one for every site learns it from the settings it asks for. */
  function scripts(): UserScript[] {
    const blocking = enabled ? pageScripts.filter(script => !script.hosts.length || !script.hosts.every(host => covers(allowed, host))) : []
    return [
      ...blocking.map(({ id, ...script }) => ({ ...script, id: `blocker:${id}` })),
      ...boosts,
    ]
  }

  /** What the extension's background page would answer its content script (`{ ok, data }`, as `sendResponse` gets it). */
  function message(tab: string, url: string, sent: { type?: string, events?: Array<{ count?: number }> } | undefined): unknown {
    const active = enabled && !covers(allowed, hostOf(url))
    switch (sent?.type) {
      case 'get-dashboard':
        return { ok: true, data: { settings: {
          enabled,
          cosmeticFiltering: true,
          aggressiveCosmetic: false,
          cookieConsentFiltering: cookieConsent,
          popupBlocking: true,
          youtubeEnhancements: true,
          twitchEnhancements: true,
          allowedSites: allowed,
          blockedSites: [],
        } } }
      case 'record-blocks': {
        // A page cannot count itself up where blocking is off: its reports are believed only where it is on.
        const hidden = active ? (sent.events ?? []).reduce((total, event) => total + (Number(event.count) > 0 ? Number(event.count) : 0), 0) : 0
        if (hidden) {
          counts.set(tab, (counts.get(tab) ?? 0) + hidden)
          options.onBlocked?.(tab, counts.get(tab)!)
        }
        return { ok: true, data: true }
      }
      case 'record-cosmetic':
        return { ok: true, data: true }
      default:
        return { ok: false, error: `The browser does not answer ${String(sent?.type)}` }
    }
  }

  function answer({ tab, url, body }: BridgeMessage): unknown {
    const { api, payload = {} } = (body ?? {}) as { api?: string, payload?: Record<string, any> }
    const area: Record<string, unknown> = storage[payload.area as keyof typeof storage] ?? storage.local
    switch (api) {
      case 'runtime.sendMessage': return message(tab, url, payload.message)
      case 'storage.get': {
        const keys = payload.keys
        if (keys === null || keys === undefined) return { ...area }
        const names: string[] = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)
        return Object.fromEntries(names.filter(name => name in area).map(name => [name, area[name]]))
      }
      case 'storage.set': Object.assign(area, payload.items); return null
      case 'storage.remove': for (const name of (payload.keys ?? []) as string[]) delete area[name]; return null
      case 'storage.clear': for (const name of Object.keys(area)) delete area[name]; return null
      default: throw new Error(`The browser does not answer ${String(api)}`)
    }
  }

  async function sync(syncOptions: { cookieConsent?: boolean } = {}) {
    cookieConsent = syncOptions.cookieConsent === true
    const query = cookieConsent ? '?cookieConsent=1' : ''
    const response = await send(`${base}/api/blocker${query}`)
    if (!response.ok) throw new Error(`The agent has no blocker lists (${response.status})`)
    const manifest = await response.json() as { lists: BlockerList[], scripts: PageScript[] }
    let compiled = 0
    for (const list of manifest.lists) {
      const reply = await web.setContentRules(list.identifier, { version: list.version })
      if (!reply.missing) continue
      const rules = await send(`${base}/api/blocker/list?id=${encodeURIComponent(list.identifier)}${cookieConsent ? '&cookieConsent=1' : ''}`)
      if (!rules.ok) throw new Error(`The agent could not send ${list.identifier} (${rules.status})`)
      await web.setContentRules(list.identifier, { version: list.version, json: await rules.text() })
      compiled++
    }
    const current = manifest.lists.map(list => list.identifier)
    for (const gone of installed.filter(identifier => !current.includes(identifier))) await web.removeContentRules(gone)
    installed = current
    pageScripts = manifest.scripts
    // Each handler is answered once, however often the lists sync.
    for (const handler of new Set(pageScripts.flatMap(script => script.bridge ?? []))) {
      if (bridges.has(handler)) continue
      bridges.add(handler)
      web.onBridge(handler, answer)
    }
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
    answer,
    blocked: tab => counts.get(tab) ?? 0,
    newPage: (tab) => { counts.delete(tab) },
  }
}
