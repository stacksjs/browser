import type { Database } from 'bun:sqlite'
import { displayHost } from '../../resources/functions/browser/address'
import { frecency } from '../../resources/functions/browser/rank'

/** A page that finished loading. */
export interface HistoryVisit { url: string, title?: string, at: number }
/** A title that arrived after its page's visit was recorded. */
export interface HistoryTitle { url: string, title: string }
export interface HistoryResult { url: string, title: string, frecency: number, lastVisitAt: number }

export interface History {
  record: (visits: HistoryVisit[]) => void
  retitle: (titles: HistoryTitle[]) => void
  /** Pages matching every word typed, most used first. */
  search: (text: string, limit?: number, now?: number) => HistoryResult[]
  recent: (limit?: number) => HistoryResult[]
  forget: (url: string) => void
  clear: () => void
}

interface Row { id: number, url: string, title: string, visits: number, recent_visits: string, last_visit_at: number }

/** How many visit times a page keeps for ranking. */
const KEPT_VISITS = 10
/** How many matches the index hands over before frecency picks the best. */
const CANDIDATES = 200

/** Only pages people visit count: no blank tabs, data: documents or browser pages. */
export function isRecordable(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * The search index is an FTS5 table over the model's own rows, using the
 * trigram tokenizer so "hub" finds "github.com" the way an address bar should.
 * Triggers keep it in step. Created here rather than in the model because
 * migrations know nothing of virtual tables; if a schema upgrade rebuilt the
 * table and dropped the triggers, they come back and the index is rebuilt.
 */
function ensureSearchIndex(db: Database): void {
  const hasTriggers = db.query(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'history_entries_search_%'`).get() as { n: number }
  if (hasTriggers.n === 3) return
  db.transaction(() => {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS history_search USING fts5(title, url, content='history_entries', content_rowid='id', tokenize='trigram')`)
    db.exec(`CREATE TRIGGER IF NOT EXISTS history_entries_search_insert AFTER INSERT ON history_entries BEGIN
      INSERT INTO history_search (rowid, title, url) VALUES (new.id, new.title, new.url); END`)
    db.exec(`CREATE TRIGGER IF NOT EXISTS history_entries_search_delete AFTER DELETE ON history_entries BEGIN
      INSERT INTO history_search (history_search, rowid, title, url) VALUES ('delete', old.id, old.title, old.url); END`)
    db.exec(`CREATE TRIGGER IF NOT EXISTS history_entries_search_update AFTER UPDATE OF title, url ON history_entries BEGIN
      INSERT INTO history_search (history_search, rowid, title, url) VALUES ('delete', old.id, old.title, old.url);
      INSERT INTO history_search (rowid, title, url) VALUES (new.id, new.title, new.url); END`)
    db.exec(`INSERT INTO history_search (history_search) VALUES ('rebuild')`)
  })()
}

/** One FTS5 phrase per word, quoted so punctuation in what was typed is never query syntax. */
function ftsQuery(words: string[]): string {
  return words.map(word => `"${word.replaceAll('"', '""')}"`).join(' AND ')
}

/** History over the app's database (`openBrowserDatabase`). */
export function createHistory(db: Database): History {
  ensureSearchIndex(db)

  const find = db.query<Row, [string]>('SELECT * FROM history_entries WHERE url = ?')
  const insert = db.query('INSERT INTO history_entries (url, host, title, visits, recent_visits, last_visit_at) VALUES (?, ?, ?, 1, ?, ?)')
  const update = db.query('UPDATE history_entries SET title = ?, visits = ?, recent_visits = ?, last_visit_at = ? WHERE id = ?')
  const setTitle = db.query(`UPDATE history_entries SET title = ? WHERE url = ? AND title <> ?`)
  const matching = db.query<Row, [string, number]>(`SELECT e.* FROM history_search s JOIN history_entries e ON e.id = s.rowid
    WHERE history_search MATCH ? ORDER BY e.last_visit_at DESC LIMIT ?`)
  const prefixed = db.query<Row, [string, string, number]>(`SELECT * FROM history_entries
    WHERE host LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' ORDER BY last_visit_at DESC LIMIT ?`)
  const latest = db.query<Row, [number]>('SELECT * FROM history_entries ORDER BY last_visit_at DESC LIMIT ?')

  const result = (row: Row, now: number): HistoryResult => {
    const times = JSON.parse(row.recent_visits) as number[]
    // The kept times stand in for every visit: scale them up to the count.
    const sampled = frecency(times.map(at => ({ at })), now)
    return { url: row.url, title: row.title, frecency: Math.round(sampled / Math.max(times.length, 1) * row.visits), lastVisitAt: row.last_visit_at }
  }

  const record = db.transaction((visits: HistoryVisit[]) => {
    for (const visit of visits) {
      if (!isRecordable(visit.url)) continue
      const row = find.get(visit.url)
      if (!row) {
        insert.run(visit.url, displayHost(visit.url), visit.title ?? '', JSON.stringify([visit.at]), visit.at)
        continue
      }
      const times = [visit.at, ...(JSON.parse(row.recent_visits) as number[])].sort((a, b) => b - a).slice(0, KEPT_VISITS)
      update.run(visit.title || row.title, row.visits + 1, JSON.stringify(times), Math.max(row.last_visit_at, visit.at), row.id)
    }
  })

  const retitle = db.transaction((titles: HistoryTitle[]) => {
    for (const { url, title } of titles) {
      if (title) setTitle.run(title, url, title)
    }
  })

  return {
    record: visits => record(visits),
    retitle: titles => retitle(titles),
    search(text, limit = 8, now = Date.now()) {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean)
      if (!words.length) return []
      // Trigrams need three characters; shorter words narrow what the index found.
      const long = words.filter(word => word.length >= 3)
      const rows = long.length
        ? matching.all(ftsQuery(long), CANDIDATES)
        : (() => {
            const like = `${words[0]!.replace(/[\\%_]/g, '\\$&')}%`
            return prefixed.all(like, like, CANDIDATES)
          })()
      return rows
        .filter((row) => {
          const haystack = `${row.title} ${row.url}`.toLowerCase()
          return words.every(word => haystack.includes(word))
        })
        .map(row => result(row, now))
        .sort((a, b) => b.frecency - a.frecency || b.lastVisitAt - a.lastVisitAt)
        .slice(0, limit)
    },
    recent: (limit = 50) => latest.all(limit).map(row => result(row, Date.now())),
    forget: (url) => { db.query('DELETE FROM history_entries WHERE url = ?').run(url) },
    clear: () => { db.exec('DELETE FROM history_entries') },
  }
}
