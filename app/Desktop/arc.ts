import { Database } from 'bun:sqlite'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ArcImportReport } from '../../resources/functions/browser/arc-import'
import { chromiumTime, importArcSidebar } from '../../resources/functions/browser/arc-import'
import type { BrowserState } from '../../resources/functions/browser/sidebar'
import type { History, ImportedPage } from './history'

/**
 * Bringing a person's Arc over: its sidebar from `StorableSidebar.json` and its
 * history from Chromium's `History` database. Both are copied to a temporary
 * folder first and read from there, so Arc's own files are never opened for
 * writing (nor locked while Arc runs), and the copies are removed afterwards.
 */

/** The most pages taken from Arc's history, the most recently visited first. */
const HISTORY_LIMIT = 50_000

export interface ArcPreview {
  found: boolean
  report?: ArcImportReport
  historyPages?: number
}

export function arcDirectory(): string {
  return process.env.BROWSER_ARC_DIR || join(homedir(), 'Library', 'Application Support', 'Arc')
}

/** Copies of what is needed, in a folder that `done` removes. */
function copies(dir: string) {
  const temp = mkdtempSync(join(tmpdir(), 'browser-arc-'))
  const copy = (from: string, name: string) => {
    if (!existsSync(from)) return null
    copyFileSync(from, join(temp, name))
    return join(temp, name)
  }
  const sidebar = copy(join(dir, 'StorableSidebar.json'), 'StorableSidebar.json')
  const historyFile = join(dir, 'User Data', 'Default', 'History')
  const history = copy(historyFile, 'History')
  // A write-ahead log holds what Arc has not checkpointed yet; the copy needs it to be complete.
  if (history) copy(`${historyFile}-wal`, 'History-wal')
  return { sidebar, history, done: () => rmSync(temp, { recursive: true, force: true }) }
}

function historyPages(file: string): ImportedPage[] {
  const db = new Database(file, { readonly: true })
  try {
    return db.query<{ url: string, title: string, visit_count: number, last_visit_time: number }, [number]>(
      `SELECT url, title, visit_count, last_visit_time FROM urls WHERE hidden = 0 AND last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT ?`,
    ).all(HISTORY_LIMIT).map(row => ({ url: row.url, title: row.title ?? '', visits: row.visit_count, lastVisitAt: chromiumTime(row.last_visit_time) }))
  }
  finally { db.close() }
}

/** What an import would bring, as counts. */
export function previewArc(dir = arcDirectory()): ArcPreview {
  const found = copies(dir)
  try {
    if (!found.sidebar && !found.history) return { found: false }
    const report = found.sidebar ? importArcSidebar(JSON.parse(readFileSync(found.sidebar, 'utf8'))).report : undefined
    return { found: true, ...(report ? { report } : {}), ...(found.history ? { historyPages: historyPages(found.history).length } : {}) }
  }
  finally { found.done() }
}

/** The sidebar as this browser's state (the window merges it), and history added to `history`. */
export function importArc(history: History, dir = arcDirectory()): { state: BrowserState | null, report: ArcImportReport | null, historyImported: number } {
  const found = copies(dir)
  try {
    const sidebar = found.sidebar ? importArcSidebar(JSON.parse(readFileSync(found.sidebar, 'utf8'))) : null
    const historyImported = found.history ? history.importPages(historyPages(found.history)) : 0
    return { state: sidebar?.state ?? null, report: sidebar?.report ?? null, historyImported }
  }
  finally { found.done() }
}

/** `GET /api/import/arc` previews; `POST` imports. */
export function arcApi(history: () => History, dir?: () => string) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
  return {
    preview(): Response {
      try { return json({ data: previewArc(dir?.()) }) }
      catch (error) { return json({ error: `Arc's data could not be read: ${(error as Error).message}` }, 500) }
    },
    run(): Response {
      try { return json({ data: importArc(history(), dir?.()) }) }
      catch (error) { return json({ error: `Arc's data could not be read: ${(error as Error).message}` }, 500) }
    },
  }
}
