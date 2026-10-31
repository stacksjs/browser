import type { Database } from 'bun:sqlite'
import { openNativeDatabase } from '@stacksjs/orm/native'
import Download from '../Models/Download'
import HistoryEntry from '../Models/HistoryEntry'
import SessionValue from '../Models/SessionValue'
import SidebarItem from '../Models/SidebarItem'
import Space from '../Models/Space'

/**
 * Every model the app keeps in `Browser.sqlite`. One file has one schema
 * snapshot, so all of them open together: a model left out here would look
 * removed, and the upgrade would refuse to drop its table.
 */
export const BROWSER_MODELS = { Download, HistoryEntry, SessionValue, SidebarItem, Space }

export function openBrowserDatabase(path: string): Database {
  const db = openNativeDatabase({ path, models: BROWSER_MODELS as never })
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
  return db
}
