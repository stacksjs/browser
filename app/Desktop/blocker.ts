/**
 * The ad blocker's rules for the window: very-good-adblock's WebKit lists and
 * page scripts (the extension's own rules), built once per run and served to
 * `resources/functions/browser/blocker.ts`, which hands them to WebKit.
 */

export interface BlockerLibrary {
  webkitContentRules: (options?: { cookieConsent?: boolean }) => Array<{ identifier: string, version: string, rules: unknown[] }>
  webkitPageScripts: () => Array<{ id: string, hosts: string[], allFrames: boolean, js: string }>
}

/** `GET /api/blocker` (the lists' versions and the page scripts) and `GET /api/blocker/list?id=` (one list's rules). */
export function blockerApi(load: () => Promise<BlockerLibrary>) {
  const built = new Map<string, Promise<{ lists: Array<{ identifier: string, version: string, json: string }>, scripts: ReturnType<BlockerLibrary['webkitPageScripts']> }>>()
  const build = (cookieConsent: boolean) => {
    const key = cookieConsent ? 'consent' : 'plain'
    if (!built.has(key)) {
      built.set(key, load().then(library => ({
        lists: library.webkitContentRules({ cookieConsent }).map(list => ({ identifier: list.identifier, version: list.version, json: JSON.stringify(list.rules) })),
        scripts: library.webkitPageScripts(),
      })))
    }
    return built.get(key)!
  }
  const consent = (request: Request) => new URL(request.url).searchParams.get('cookieConsent') === '1'
  return {
    async manifest(request: Request): Promise<Response> {
      const { lists, scripts } = await build(consent(request))
      return Response.json({ lists: lists.map(({ identifier, version }) => ({ identifier, version })), scripts }, { headers: { 'cache-control': 'no-store' } })
    },
    async list(request: Request): Promise<Response> {
      const id = new URL(request.url).searchParams.get('id')
      const list = (await build(consent(request))).lists.find(each => each.identifier === id)
      return list ? new Response(list.json, { headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 404 })
    },
  }
}
