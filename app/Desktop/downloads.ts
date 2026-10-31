import type { Database } from 'bun:sqlite'
import type { DownloadRecord } from '../../resources/functions/browser/library'

export interface Downloads {
  /** A download's latest state: the first report adds it, later ones move it on. */
  record: (download: DownloadRecord) => void
  /** Newest first. */
  list: (limit?: number) => DownloadRecord[]
  /** Forget finished and failed rows (the files stay). */
  clear: () => void
}

interface Row { uid: string, url: string, path: string, name: string, state: DownloadRecord['state'], received: number, total: number, started_at: number, finished_at: number }

const fromRow = (row: Row): DownloadRecord => ({
  id: row.uid, url: row.url, path: row.path, name: row.name, state: row.state,
  received: row.received, total: row.total, startedAt: row.started_at, ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
})

/** Downloads over the app's database (`openBrowserDatabase`). */
export function createDownloads(db: Database): Downloads {
  const put = db.query(`INSERT INTO downloads (uid, url, path, name, state, received, total, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET path = excluded.path, name = excluded.name, state = excluded.state,
      received = excluded.received, total = excluded.total, finished_at = excluded.finished_at`)
  const list = db.query<Row, [number]>('SELECT * FROM downloads ORDER BY started_at DESC LIMIT ?')
  return {
    record(download) {
      put.run(download.id, download.url, download.path, download.name, download.state, download.received, download.total, download.startedAt, download.finishedAt ?? 0)
    },
    list: (limit = 100) => list.all(limit).map(fromRow),
    clear: () => { db.exec(`DELETE FROM downloads WHERE state <> 'started'`) },
  }
}
