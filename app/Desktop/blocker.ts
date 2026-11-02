/**
 * The ad blocker's rules for the window: very-good-adblock's WebKit lists and
 * scripts (the extension's own rules), built once per run and served to
 * `resources/functions/browser/blocker.ts`, which hands them to WebKit.
 */

export interface BlockerList { id: string, version: string, group: string, enabled: boolean, json: string }
export interface BlockerScript {
  id: string
  matches: string[]
  runAt: 'document-start' | 'document-end'
  allFrames: boolean
  world: 'page' | 'isolated'
  bridged: boolean
  source: string
}

/** The part of very-good-adblock the agent uses. `dir` is where its WebKit lists and scripts are, when not beside its modules. */
export interface BlockerLibrary {
  webkitRuleLists: (options?: { includeDisabled?: boolean, dir?: string }) => Promise<BlockerList[]>
  webkitUserScripts: (options?: { dir?: string }) => BlockerScript[]
  webkitManifest: (options?: { dir?: string }) => { bridge: { messageHandler: string } }
}

/** A script as the window installs it: the hosts it runs on (none is every site) and the handler it posts to. */
export interface PageScript { id: string, hosts: string[], world: 'page' | 'isolated', at: 'start' | 'end', allFrames: boolean, bridge?: string, js: string }

/** The list that hides cookie banners, which the extension leaves off by default and Settings turns on. */
export const CONSENT_GROUP = 'very_good_adblock_cosmetic_consent'

/**
 * The hosts extension match patterns name, with their subdomains, for a user
 * script that can only be told hosts. A pattern for every host (`<all_urls>`,
 * `*://*\/*`) makes it every site, which is an empty list; patterns for no web
 * host (`file:///*`) leave nothing, which is undefined.
 */
export function matchedHosts(matches: string[]): string[] | undefined {
  const hosts = new Set<string>()
  for (const pattern of matches) {
    if (pattern === '<all_urls>') return []
    const host = /^(?:\*|https?):\/\/([^/]+)\//.exec(pattern)?.[1]
    if (host === '*') return []
    if (host) hosts.add(host.replace(/^\*\./, '').toLowerCase())
  }
  return hosts.size ? [...hosts] : undefined
}

/** The window's form of a script, or undefined for one that runs on no web page. */
export function pageScript(script: BlockerScript, bridge: string): PageScript | undefined {
  const hosts = matchedHosts(script.matches)
  if (!hosts) return undefined
  return {
    id: script.id,
    hosts,
    world: script.world,
    at: script.runAt === 'document-start' ? 'start' : 'end',
    allFrames: script.allFrames,
    ...(script.bridged ? { bridge } : {}),
    js: script.source,
  }
}

/**
 * `GET /api/blocker` (the lists' versions, the scripts and their bridge) and `GET /api/blocker/list?id=` (one list's rules).
 * `dir` is the library's WebKit data in the built app, which has no node_modules (`macos.agent.resources`).
 */
export function blockerApi(load: () => Promise<BlockerLibrary>, options: { dir?: string } = {}) {
  let built: Promise<{ lists: BlockerList[], scripts: PageScript[], bridge: string }> | undefined
  const at = options.dir ? { dir: options.dir } : {}
  const build = () => built ??= load().then(async (library) => {
    const bridge = library.webkitManifest(at).bridge.messageHandler
    return { lists: await library.webkitRuleLists({ includeDisabled: true, ...at }), scripts: library.webkitUserScripts(at).flatMap(script => pageScript(script, bridge) ?? []), bridge }
  })
  // The extension's enabled lists, and the cookie-banner list when asked for; its other off-by-default lists stay off.
  const wanted = (request: Request) => {
    const consent = new URL(request.url).searchParams.get('cookieConsent') === '1'
    return (list: BlockerList) => list.enabled || (consent && list.group === CONSENT_GROUP)
  }
  return {
    async manifest(request: Request): Promise<Response> {
      const { lists, scripts, bridge } = await build()
      return Response.json({ lists: lists.filter(wanted(request)).map(({ id, version }) => ({ identifier: id, version })), scripts, bridge }, { headers: { 'cache-control': 'no-store' } })
    },
    async list(request: Request): Promise<Response> {
      const id = new URL(request.url).searchParams.get('id')
      const list = (await build()).lists.filter(wanted(request)).find(each => each.id === id)
      return list ? new Response(list.json, { headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 404 })
    },
  }
}
