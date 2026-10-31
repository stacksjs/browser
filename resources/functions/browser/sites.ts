/**
 * What the browser remembers per site: whether the ad blocker runs there, its
 * zoom, and the answers to its camera and microphone requests. The agent keeps
 * them (app/Desktop/sites.ts); these are the decisions made from them.
 */

export type PermissionKind = 'camera' | 'microphone'
export type Decision = 'ask' | 'allow' | 'deny'

export interface SiteSettings {
  /** The site as `siteKey` names it. */
  host: string
  /** The ad blocker runs here. Default true. */
  blocking: boolean
  /** Page zoom, 1 is actual size. */
  zoom: number
  camera: Decision
  microphone: Decision
}

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

export function defaultSettings(host: string): SiteSettings {
  return { host, blocking: true, zoom: 1, camera: 'ask', microphone: 'ask' }
}

/** The site a page belongs to: its host without `www.`, or null for pages that are not on the web. */
export function siteKey(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  }
  catch { return null }
}

export function settingsFor(all: Record<string, SiteSettings>, host: string | null): SiteSettings | null {
  return host ? all[host] ?? defaultSettings(host) : null
}

/**
 * How to answer a site's request for a device: what was remembered, else ask.
 * `camera+microphone` is granted only when both are, and denied when either is.
 */
export function decide(settings: SiteSettings, kind: PermissionKind | 'camera+microphone'): Decision {
  if (kind !== 'camera+microphone') return settings[kind]
  if (settings.camera === 'deny' || settings.microphone === 'deny') return 'deny'
  return settings.camera === 'allow' && settings.microphone === 'allow' ? 'allow' : 'ask'
}

/** The settings after the person answered a request, remembered for next time. */
export function remember(settings: SiteSettings, kind: PermissionKind | 'camera+microphone', decision: 'allow' | 'deny'): SiteSettings {
  if (kind === 'camera+microphone') return { ...settings, camera: decision, microphone: decision }
  return { ...settings, [kind]: decision }
}

/** The next zoom step in or out of `zoom`. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find(step => step > zoom + 0.001) ?? ZOOM_STEPS.at(-1)!
  return [...ZOOM_STEPS].reverse().find(step => step < zoom - 0.001) ?? ZOOM_STEPS[0]!
}

/** Sites where the blocker is off, for `craft.web.allowContent`. */
export function unblockedHosts(all: Record<string, SiteSettings>): string[] {
  return Object.values(all).filter(site => !site.blocking).map(site => site.host).sort()
}

/** A request's words for the prompt: "camera", "microphone", "camera and microphone". */
export function permissionWords(kind: PermissionKind | 'camera+microphone'): string {
  return kind === 'camera+microphone' ? 'camera and microphone' : kind
}

/** Site settings over the agent; reads that fail come back empty, writes that fail are dropped. */
export function createSitesClient(options: { base: string, fetch?: (input: string, init?: RequestInit) => Promise<Response> }) {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  return {
    async all(): Promise<Record<string, SiteSettings>> {
      try {
        const response = await send(`${base}/api/sites`)
        return response.ok ? ((await response.json()) as { data: Record<string, SiteSettings> }).data : {}
      }
      catch { return {} }
    },
    async save(settings: SiteSettings): Promise<void> {
      try { await send(`${base}/api/sites`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) }) }
      catch {}
    },
  }
}
