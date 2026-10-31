import type { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { response, route } from '@stacksjs/router'
import desktop from '../../config/desktop'
import { openBrowserDatabase } from './database'
import { createDownloads } from './downloads'
import type { Downloads } from './downloads'
import { downloadsApi } from './downloads-api'
import { createHistory } from './history'
import type { History } from './history'
import { historyApi } from './history-api'
import { createSession } from './session'
import type { Session } from './session'
import { sessionApi } from './session-api'
import { createSuggestions, suggestApi } from './suggest'

/**
 * Routes only the desktop app serves. They run inside the app, on 127.0.0.1,
 * next to everything in routes/ - which is mounted as `app/Routes.ts` says
 * (`routes/api.ts` under /api). These are not prefixed: write the full path.
 *
 * Whatever this file imports is compiled into the built app.
 */

/** `~/Library/Application Support/<App>`, where the agent keeps its port and lock too. */
const dataDir = process.env.STACKS_DESKTOP_DATA_DIR || join(homedir(), 'Library', 'Application Support', desktop.macos!.appName)

// One database for everything the app keeps, opened on the first request.
let db: Database | undefined
let history: History | undefined
let session: Session | undefined
let downloads: Downloads | undefined
const database = () => (db ??= openBrowserDatabase(join(dataDir, 'Browser.sqlite')))
const suggestRoutes = suggestApi(createSuggestions())
const downloadRoutes = downloadsApi(() => (downloads ??= createDownloads(database())))
const historyRoutes = historyApi(() => (history ??= createHistory(database())))
const sessionRoutes = sessionApi(() => {
  if (!session) {
    session = createSession(database())
    session.prune()
  }
  return session
})

route.get('/api/desktop/status', () => response.json({ app: 'Browser', ok: true }))

// The agent only answers its own window (session cookie and Host check), which
// is stronger than a CSRF token, so these writes skip it.
route.get('/api/history', request => historyRoutes.search(request))
route.post('/api/history', request => historyRoutes.record(request)).skipCsrf()
route.delete('/api/history', request => historyRoutes.forget(request)).skipCsrf()
route.get('/api/session', () => sessionRoutes.load())
route.put('/api/session', request => sessionRoutes.save(request)).skipCsrf()
route.get('/api/session/archive', request => sessionRoutes.archived(request))
route.get('/api/suggest', request => suggestRoutes.get(request))
route.get('/api/downloads', request => downloadRoutes.list(request))
route.post('/api/downloads', request => downloadRoutes.record(request)).skipCsrf()
route.delete('/api/downloads', () => downloadRoutes.clear()).skipCsrf()
