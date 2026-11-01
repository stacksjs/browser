/**
 * First launch: welcome, bring Arc over, pick a colour, become the default
 * browser, and the few keys worth knowing. The import itself runs in the agent
 * (app/Desktop/arc.ts) on copies of Arc's files.
 */

import type { ArcImportReport } from './arc-import'
import type { BrowserState } from './sidebar'

export type OnboardingStep = 'welcome' | 'import' | 'theme' | 'default' | 'done'
export const ONBOARDING_STEPS: OnboardingStep[] = ['welcome', 'import', 'theme', 'default', 'done']

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null
}

/** `2,000`, spelled out rather than through Intl, which the screen's engine need not have. */
const grouped = (count: number) => String(Math.round(count)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const plural = (count: number, one: string, many = `${one}s`) => `${grouped(count)} ${count === 1 ? one : many}`

/** "3 spaces, 12 pinned tabs, 4 favorites and 2,000 pages of history", leaving out what Arc had none of. */
export function importSummary(report: ArcImportReport | undefined, historyPages = 0): string {
  const parts = [
    report?.spaces ? plural(report.spaces, 'space') : '',
    report?.pinned ? plural(report.pinned, 'pinned tab') : '',
    report?.favorites ? plural(report.favorites, 'favorite') : '',
    report?.today ? plural(report.today, 'open tab') : '',
    historyPages ? `${plural(historyPages, 'page')} of history` : '',
  ].filter(Boolean)
  if (!parts.length) return 'Nothing to bring over yet.'
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

export const SETTLE_IN_TIPS = [
  { keys: '⌘T', title: 'New tab', detail: 'Type an address, a search, a tab or an action.' },
  { keys: '⌘S', title: 'Hide the sidebar', detail: 'Point at the left edge to bring it back.' },
  { keys: '⌘D', title: 'Pin a tab', detail: 'Pinned tabs stay; Today\'s tabs are archived after a day.' },
  { keys: '⌘⇧=', title: 'Split view', detail: 'Up to four tabs side by side.' },
  { keys: '⌃1-9', title: 'Switch spaces', detail: 'Each space has its own tabs, colours and profile.' },
]

/** Arc's sign-ins as the agent reads them (app/Desktop/arc-cookies.ts). */
export interface ArcSignIns {
  profiles: Array<{ profile: string, cookies: Array<{ name: string, value: string, domain: string }> }>
  skipped: number
}

export interface ImportClient {
  preview: () => Promise<{ found: boolean, report?: ArcImportReport, historyPages?: number, signIns?: { cookies: number, sites: number } }>
  run: () => Promise<{ state: BrowserState | null, report: ArcImportReport | null, historyImported: number } | null>
  /** Arc's sign-ins, once the person allows the Keychain prompt; an error says why not. */
  signIns: () => Promise<{ data?: ArcSignIns, error?: string }>
}

/** The part of `craft.web` that keeping sign-ins uses. */
export interface CookieStore {
  setCookies: (options: { profile: string, cookies: ArcSignIns['profiles'][number]['cookies'] }) => Promise<{ set: number, skipped: number }>
}

/**
 * Hands Arc's sign-ins to WebKit, one profile's store at a time, for the
 * profiles this browser's spaces use (Arc's other profiles have no space to be
 * signed in from). Resolves how many cookies were kept and for how many sites.
 */
export async function keepSignedIn(signIns: ArcSignIns, store: CookieStore, profiles: string[]): Promise<{ cookies: number, sites: number }> {
  const wanted = new Set([...profiles, 'default'])
  const sites = new Set<string>()
  let cookies = 0
  for (const each of signIns.profiles) {
    if (!wanted.has(each.profile)) continue
    const result = await store.setCookies({ profile: each.profile, cookies: each.cookies })
    cookies += result.set
    for (const cookie of each.cookies) sites.add(cookie.domain.replace(/^\./, ''))
  }
  return { cookies, sites: cookies ? sites.size : 0 }
}

/** The offer, before anything is read: the Keychain prompt is the person's to allow. */
export function signInOffer(count: { sites: number }): string {
  return `Stay signed in to ${plural(count.sites, 'site')}? macOS asks you to allow reading Arc's sign-ins from your Keychain.`
}

/** "You stay signed in to 42 sites." */
export function signInSummary(kept: { sites: number }): string {
  return kept.sites ? `You stay signed in to ${plural(kept.sites, 'site')}.` : 'Arc had no sign-ins to keep.'
}

export function createImportClient(options: { base: string, fetch?: (input: string, init?: RequestInit) => Promise<Response> }): ImportClient {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  return {
    async preview() {
      try {
        const response = await send(`${base}/api/import/arc`)
        return response.ok ? ((await response.json()) as { data: { found: boolean } }).data : { found: false }
      }
      catch { return { found: false } }
    },
    async run() {
      try {
        const response = await send(`${base}/api/import/arc`, { method: 'POST' })
        return response.ok ? ((await response.json()) as { data: any }).data : null
      }
      catch { return null }
    },
    async signIns() {
      try {
        const response = await send(`${base}/api/import/arc/cookies`, { method: 'POST' })
        const body = await response.json() as { data?: ArcSignIns, error?: string }
        return response.ok && body.data ? { data: body.data } : { error: body.error || 'Arc\'s sign-ins could not be read.' }
      }
      catch { return { error: 'Arc\'s sign-ins could not be read.' } }
    },
  }
}
