/**
 * The browser's settings, kept in `craft.storage` (UserDefaults) so every
 * window reads them synchronously at launch. The Settings window writes them
 * and posts `{ type: 'settings' }` so open windows pick them up.
 */

import type { SearchEngineName } from './address'
import { SEARCH_ENGINES } from './address'

export type ArchiveAfter = '12h' | '24h' | '7d' | '30d' | 'never'

export interface BrowserSettings {
  searchEngine: SearchEngineName
  /** Links other apps open go to a small floating window (Arc's Little Arc). */
  littleWindowForLinks: boolean
  /** The ad blocker, everywhere. */
  blocking: boolean
  /** Cookie-consent banners hidden too. */
  cookieConsent: boolean
  /** Today's tabs left alone this long go to the archive. */
  archiveAfter: ArchiveAfter
}

export const DEFAULT_SETTINGS: BrowserSettings = { searchEngine: 'google', littleWindowForLinks: true, blocking: true, cookieConsent: false, archiveAfter: '24h' }

export const ARCHIVE_CHOICES: Array<{ label: string, value: ArchiveAfter }> = [
  { label: 'After 12 hours', value: '12h' },
  { label: 'After 24 hours', value: '24h' },
  { label: 'After 7 days', value: '7d' },
  { label: 'After 30 days', value: '30d' },
  { label: 'Never', value: 'never' },
]

export const ENGINE_CHOICES: Array<{ label: string, value: SearchEngineName }> = (Object.keys(SEARCH_ENGINES) as SearchEngineName[]).map(value => ({ label: SEARCH_ENGINES[value].name, value }))

const HOUR = 3_600_000
/** How long a Today tab may sit before it is archived; null for never. */
export function archiveAfterMs(choice: ArchiveAfter): number | null {
  return { '12h': 12 * HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR, 'never': null }[choice]
}

const KEY = 'browser.settings'

/** Settings as stored, any field missing or unreadable taking its default. */
export function readSettings(read: (key: string) => unknown): BrowserSettings {
  const stored = read(KEY)
  const raw = stored && typeof stored === 'object' ? stored as Partial<BrowserSettings> : {}
  return {
    searchEngine: raw.searchEngine && raw.searchEngine in SEARCH_ENGINES ? raw.searchEngine : DEFAULT_SETTINGS.searchEngine,
    littleWindowForLinks: typeof raw.littleWindowForLinks === 'boolean' ? raw.littleWindowForLinks : DEFAULT_SETTINGS.littleWindowForLinks,
    blocking: typeof raw.blocking === 'boolean' ? raw.blocking : DEFAULT_SETTINGS.blocking,
    cookieConsent: typeof raw.cookieConsent === 'boolean' ? raw.cookieConsent : DEFAULT_SETTINGS.cookieConsent,
    archiveAfter: ARCHIVE_CHOICES.some(choice => choice.value === raw.archiveAfter) ? raw.archiveAfter! : DEFAULT_SETTINGS.archiveAfter,
  }
}

export function writeSettings(write: (key: string, value: unknown) => void, settings: BrowserSettings): void {
  write(KEY, settings)
}
