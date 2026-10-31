import type { Database } from 'bun:sqlite'
import type { SessionChange } from '../../resources/functions/browser/session'
import type { BrowserState, Item, Space } from '../../resources/functions/browser/sidebar'

/** A tab that left the sidebar stays this long, for the Library, then goes. */
export const ARCHIVE_DAYS = 30
const DAY = 86_400_000

export interface Session {
  /** The sidebar as the screen left it; `null` before anything was saved. */
  load: () => BrowserState | null
  /** Apply what changed, all at once. */
  save: (change: SessionChange, now?: number) => void
  /** Tabs that left the sidebar, most recent first. */
  archived: (limit?: number) => Array<Item & { archivedAt: number }>
  /** Forget archived tabs older than `ARCHIVE_DAYS`. */
  prune: (now?: number) => void
}

interface ItemRow {
  uid: string
  kind: Item['kind']
  section: Item['section']
  space_uid: string
  parent_uid: string
  sort_key: string
  title: string
  name: string
  url: string
  saved_url: string
  icon: string
  collapsed: number
  created_at: number
  last_active_at: number
  archived_at: number
}

interface SpaceRow { uid: string, name: string, icon: string, profile: string, theme: string }

function itemFrom(row: ItemRow): Item {
  return {
    id: row.uid,
    kind: row.kind,
    section: row.section,
    space: row.space_uid || null,
    parent: row.parent_uid || null,
    order: row.sort_key,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    ...(row.title ? { title: row.title } : {}),
    ...(row.name ? { name: row.name } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.saved_url ? { savedUrl: row.saved_url } : {}),
    ...(row.icon ? { icon: row.icon } : {}),
    ...(row.collapsed ? { collapsed: true } : {}),
  }
}

function spaceFrom(row: SpaceRow): Space {
  return { id: row.uid, name: row.name, profile: row.profile, theme: JSON.parse(row.theme), ...(row.icon ? { icon: row.icon } : {}) }
}

/** The sidebar over the app's database (`openBrowserDatabase`). */
export function createSession(db: Database): Session {
  const putItem = db.query(`INSERT INTO sidebar_items
    (uid, kind, section, space_uid, parent_uid, sort_key, title, name, url, saved_url, icon, collapsed, created_at, last_active_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT (uid) DO UPDATE SET kind = excluded.kind, section = excluded.section, space_uid = excluded.space_uid,
      parent_uid = excluded.parent_uid, sort_key = excluded.sort_key, title = excluded.title, name = excluded.name, url = excluded.url,
      saved_url = excluded.saved_url, icon = excluded.icon, collapsed = excluded.collapsed,
      last_active_at = excluded.last_active_at, archived_at = 0`)
  const archiveItem = db.query('UPDATE sidebar_items SET archived_at = ? WHERE uid = ? AND archived_at = 0')
  const putSpace = db.query(`INSERT INTO spaces (uid, name, icon, profile, theme, position) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET name = excluded.name, icon = excluded.icon, profile = excluded.profile,
      theme = excluded.theme, position = excluded.position`)
  const putValue = db.query('INSERT INTO session_values (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value')
  const spaces = db.query<SpaceRow, []>('SELECT * FROM spaces ORDER BY position')
  const items = db.query<ItemRow, []>('SELECT * FROM sidebar_items WHERE archived_at = 0')
  const archived = db.query<ItemRow, [number]>('SELECT * FROM sidebar_items WHERE archived_at > 0 ORDER BY archived_at DESC LIMIT ?')
  const values = db.query<{ name: string, value: string }, []>('SELECT name, value FROM session_values')

  const save = db.transaction((change: SessionChange, now: number) => {
    if (change.spaces) {
      change.spaces.forEach((space, position) => putSpace.run(space.id, space.name, space.icon ?? '', space.profile, JSON.stringify(space.theme), position))
      const kept = change.spaces.map(space => space.id)
      db.query(`DELETE FROM spaces WHERE uid NOT IN (${kept.map(() => '?').join(', ')})`).run(...kept)
    }
    for (const item of change.put ?? []) {
      putItem.run(item.id, item.kind, item.section, item.space ?? '', item.parent ?? '', item.order, item.title ?? '', item.name ?? '', item.url ?? '',
        item.savedUrl ?? '', item.icon ?? '', item.collapsed ? 1 : 0, item.createdAt, item.lastActiveAt)
    }
    for (const id of change.remove ?? []) archiveItem.run(now, id)
    for (const name of ['activeSpace', 'selected', 'closed'] as const) {
      if (change[name] !== undefined) putValue.run(name, JSON.stringify(change[name]))
    }
  })

  return {
    load() {
      const saved = spaces.all().map(spaceFrom)
      if (!saved.length) return null
      const meta = Object.fromEntries(values.all().map(row => [row.name, JSON.parse(row.value)]))
      const activeSpace = saved.some(space => space.id === meta.activeSpace) ? meta.activeSpace as string : saved[0]!.id
      return {
        spaces: saved,
        items: Object.fromEntries(items.all().map(row => [row.uid, itemFrom(row)])),
        activeSpace,
        selected: { ...Object.fromEntries(saved.map(space => [space.id, null])), ...(meta.selected ?? {}) },
        closed: meta.closed ?? [],
      }
    },
    save: (change, now = Date.now()) => save(change, now),
    archived: (limit = 100) => archived.all(limit).map(row => ({ ...itemFrom(row), archivedAt: row.archived_at })),
    prune(now = Date.now()) {
      db.query('DELETE FROM sidebar_items WHERE archived_at > 0 AND archived_at < ?').run(now - ARCHIVE_DAYS * DAY)
    },
  }
}
