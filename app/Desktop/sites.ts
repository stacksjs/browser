import type { Database } from 'bun:sqlite'
import type { SiteSettings } from '../../resources/functions/browser/sites'
import { defaultSettings } from '../../resources/functions/browser/sites'

export interface Sites {
  /** Every site with a setting that differs from the defaults, by host. */
  all: () => Record<string, SiteSettings>
  /** Keep a site's settings; one back at every default is forgotten. */
  save: (settings: SiteSettings) => void
  forget: (host: string) => void
}

interface Row { host: string, blocking: number, zoom: number, camera: SiteSettings['camera'], microphone: SiteSettings['microphone'] }

const isDefault = (settings: SiteSettings) => {
  const plain = defaultSettings(settings.host)
  return settings.blocking === plain.blocking && settings.zoom === plain.zoom && settings.camera === plain.camera && settings.microphone === plain.microphone
}

/** Site settings over the app's database (`openBrowserDatabase`). */
export function createSites(db: Database): Sites {
  const put = db.query(`INSERT INTO site_settings (host, blocking, zoom, camera, microphone) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (host) DO UPDATE SET blocking = excluded.blocking, zoom = excluded.zoom, camera = excluded.camera, microphone = excluded.microphone`)
  const remove = db.query('DELETE FROM site_settings WHERE host = ?')
  const rows = db.query<Row, []>('SELECT host, blocking, zoom, camera, microphone FROM site_settings')
  return {
    all: () => Object.fromEntries(rows.all().map(row => [row.host, { host: row.host, blocking: Boolean(row.blocking), zoom: row.zoom, camera: row.camera, microphone: row.microphone }])),
    save(settings) {
      if (isDefault(settings)) remove.run(settings.host)
      else put.run(settings.host, settings.blocking ? 1 : 0, settings.zoom, settings.camera, settings.microphone)
    },
    forget: host => void remove.run(host),
  }
}

const DECISIONS = ['ask', 'allow', 'deny']

/** The settings as sent, or null when they are not a site's settings. */
export function siteSettingsFrom(value: any): SiteSettings | null {
  if (!value || typeof value !== 'object' || typeof value.host !== 'string' || !/^[a-z0-9.-]{1,253}$/.test(value.host)) return null
  if (typeof value.blocking !== 'boolean' || !Number.isFinite(value.zoom) || value.zoom < 0.25 || value.zoom > 5) return null
  if (!DECISIONS.includes(value.camera) || !DECISIONS.includes(value.microphone)) return null
  return { host: value.host, blocking: value.blocking, zoom: value.zoom, camera: value.camera, microphone: value.microphone }
}

/** Site settings over the agent: `GET` all, `PUT` one. */
export function sitesApi(sites: () => Sites) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'no-store' } })
  return {
    all: (): Response => json({ data: sites().all() }),
    async save(request: Request): Promise<Response> {
      let body: unknown
      try { body = await request.json() }
      catch { return json({ error: 'Expected JSON' }, 400) }
      const settings = siteSettingsFrom(body)
      if (!settings) return json({ error: 'Expected a site\'s settings' }, 422)
      sites().save(settings)
      return new Response(null, { status: 204 })
    },
  }
}
