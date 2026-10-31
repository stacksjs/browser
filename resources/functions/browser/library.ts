/**
 * The Library: tabs that left the sidebar (Archive), pages visited (History)
 * and files downloaded (Downloads). The agent keeps all three; this is the
 * screen's side, plus the pure pieces the lists are drawn from.
 */

import type { Item } from './sidebar'

export type DownloadState = 'started' | 'finished' | 'failed' | 'cancelled'

export interface DownloadRecord {
  /** Craft's id for the download. */
  id: string
  url: string
  /** Where the file is saved; empty until a destination is chosen. */
  path: string
  name: string
  state: DownloadState
  received: number
  /** 0 when the server did not say how big it is. */
  total: number
  startedAt: number
  finishedAt?: number
}

/** What Craft reports for a download (`craft.web.on('download')`). */
export interface DownloadEvent {
  id: string
  state: 'started' | 'progress' | 'finished' | 'failed'
  url?: string
  path?: string
  name?: string
  received?: number
  total?: number
}

export type ArchivedTab = Item & { archivedAt: number }
export interface VisitedPage { url: string, title: string, lastVisitAt: number }

/**
 * A download after one report. Progress only moves the counts; the first
 * report starts the row, the last one ends it.
 */
export function applyDownload(previous: DownloadRecord | undefined, event: DownloadEvent, now = Date.now()): DownloadRecord {
  const base: DownloadRecord = previous ?? { id: event.id, url: event.url ?? '', path: '', name: '', state: 'started', received: 0, total: 0, startedAt: now }
  const next: DownloadRecord = {
    ...base,
    ...(event.url ? { url: event.url } : {}),
    ...(event.path ? { path: event.path } : {}),
    ...(event.name ? { name: event.name } : {}),
    received: Math.max(base.received, event.received ?? 0),
    total: event.total && event.total > 0 ? event.total : base.total,
  }
  if (event.state === 'finished' || event.state === 'failed') {
    next.state = event.state
    next.finishedAt = now
    if (event.state === 'finished' && next.total) next.received = next.total
  }
  return next
}

/** How far along a download is, 0 to 1; null when its size is unknown. */
export function downloadFraction(download: DownloadRecord): number | null {
  if (download.state === 'finished') return 1
  return download.total > 0 ? Math.min(1, download.received / download.total) : null
}

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB']
/** `1.4 MB`, the way Finder counts (1000, not 1024). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Zero bytes'
  const power = Math.min(UNITS.length - 1, Math.floor(Math.log10(bytes) / 3))
  const value = bytes / 1000 ** power
  return power === 0 ? `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}` : `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${UNITS[power]}`
}

export interface DayGroup<T> { label: string, entries: T[] }

const DAY = 86_400_000
const dateLabel = (date: Date, now: Date) => `${MONTHS[date.getMonth()]} ${date.getDate()}${date.getFullYear() !== now.getFullYear() ? `, ${date.getFullYear()}` : ''}`
function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** `3:07 PM`. Spelled out rather than through Intl, which the screen's engine need not have. */
export function formatTime(at: number): string {
  const date = new Date(at)
  const hours = date.getHours()
  return `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

/** Entries under Today, Yesterday, a weekday this week, then a date, newest first. */
export function groupByDay<T>(entries: T[], at: (entry: T) => number, now = Date.now()): Array<DayGroup<T>> {
  const today = startOfDay(now)
  const groups: Array<DayGroup<T>> = []
  for (const entry of [...entries].sort((a, b) => at(b) - at(a))) {
    const day = startOfDay(at(entry))
    const label = day >= today ? 'Today'
      : day >= today - DAY ? 'Yesterday'
        : day > today - 7 * DAY ? WEEKDAYS[new Date(day).getDay()]!
          : dateLabel(new Date(day), new Date(now))
    const last = groups.at(-1)
    if (last?.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}

export interface LibraryClientOptions {
  /** The agent's origin (`craft.app.url`). */
  base: string
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
}

export interface LibraryClient {
  archived: (limit?: number) => Promise<ArchivedTab[]>
  /** The latest pages, or those matching `text`. */
  history: (text?: string, limit?: number) => Promise<VisitedPage[]>
  forgetPage: (url: string) => Promise<void>
  downloads: (limit?: number) => Promise<DownloadRecord[]>
  /** Keep a download's state; progress between start and end need not be sent. */
  recordDownload: (download: DownloadRecord) => Promise<void>
  clearDownloads: () => Promise<void>
}

/** The Library over the agent. Reads that fail come back empty: the Library is never worth an error. */
export function createLibraryClient(options: LibraryClientOptions): LibraryClient {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  const read = async <T>(path: string): Promise<T[]> => {
    try {
      const response = await send(`${base}${path}`)
      return response.ok ? ((await response.json()) as { data: T[] }).data : []
    }
    catch { return [] }
  }
  const write = async (path: string, init: RequestInit): Promise<void> => {
    try { await send(`${base}${path}`, init) }
    catch {}
  }
  return {
    archived: (limit = 100) => read<ArchivedTab>(`/api/session/archive?limit=${limit}`),
    history: (text = '', limit = 100) => read<VisitedPage>(`/api/history?limit=${limit}${text.trim() ? `&q=${encodeURIComponent(text.trim())}` : ''}`),
    forgetPage: url => write(`/api/history?url=${encodeURIComponent(url)}`, { method: 'DELETE' }),
    downloads: (limit = 100) => read<DownloadRecord>(`/api/downloads?limit=${limit}`),
    recordDownload: download => write('/api/downloads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(download) }),
    clearDownloads: () => write('/api/downloads', { method: 'DELETE' }),
  }
}
