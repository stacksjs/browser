import type { Database } from 'bun:sqlite'
import type { Boost } from '../../resources/functions/browser/boosts'

interface Row { uid: string, host: string, name: string, css: string, js: string, zapped: string, enabled: number }

/** Boosts over the app's database (`openBrowserDatabase`). */
export function createBoosts(db: Database) {
  const put = db.query(`INSERT INTO boosts (uid, host, name, css, js, zapped, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (uid) DO UPDATE SET host = excluded.host, name = excluded.name, css = excluded.css, js = excluded.js, zapped = excluded.zapped, enabled = excluded.enabled`)
  const rows = db.query<Row, []>('SELECT uid, host, name, css, js, zapped, enabled FROM boosts ORDER BY host')
  return {
    all: (): Boost[] => rows.all().map(row => ({ id: row.uid, host: row.host, name: row.name, css: row.css, js: row.js, zapped: JSON.parse(row.zapped), enabled: Boolean(row.enabled) })),
    save: (boost: Boost) => void put.run(boost.id, boost.host, boost.name, boost.css, boost.js, JSON.stringify(boost.zapped), boost.enabled ? 1 : 0),
    remove: (id: string) => void db.query('DELETE FROM boosts WHERE uid = ?').run(id),
  }
}
export type Boosts = ReturnType<typeof createBoosts>

/** The boost as sent, or null when it is not one. */
export function boostFrom(value: any): Boost | null {
  if (!value || typeof value !== 'object') return null
  const text = (key: string, max: number) => typeof value[key] === 'string' && value[key].length <= max
  if (!text('id', 64) || !value.id || !text('host', 255) || !/^[a-z0-9.-]+$/.test(value.host) || !text('name', 255) || !text('css', 200_000) || !text('js', 200_000)) return null
  if (!Array.isArray(value.zapped) || value.zapped.length > 1000 || !value.zapped.every((each: unknown) => typeof each === 'string' && each.length < 2000) || typeof value.enabled !== 'boolean') return null
  return { id: value.id, host: value.host, name: value.name, css: value.css, js: value.js, zapped: value.zapped, enabled: value.enabled }
}

/** Boosts over the agent: `GET` all, `PUT` one, `DELETE ?id=`. */
export function boostsApi(boosts: () => Boosts) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
  return {
    all: (): Response => json({ data: boosts().all() }),
    async save(request: Request): Promise<Response> {
      let body: unknown
      try { body = await request.json() }
      catch { return json({ error: 'Expected JSON' }, 400) }
      const boost = boostFrom(body)
      if (!boost) return json({ error: 'Expected a boost' }, 422)
      boosts().save(boost)
      return new Response(null, { status: 204 })
    },
    remove(request: Request): Response {
      const id = new URL(request.url).searchParams.get('id')
      if (id) boosts().remove(id)
      return new Response(null, { status: 204 })
    },
  }
}
