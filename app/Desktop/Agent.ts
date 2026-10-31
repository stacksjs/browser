import { homedir } from 'node:os'
import { join } from 'node:path'
import { response, route } from '@stacksjs/router'
import desktop from '../../config/desktop'
import type { History } from './history'
import { openHistory } from './history'
import { historyApi } from './history-api'

/**
 * Routes only the desktop app serves. They run inside the app, on 127.0.0.1,
 * next to everything in routes/ - which is mounted as `app/Routes.ts` says
 * (`routes/api.ts` under /api). These are not prefixed: write the full path.
 *
 * Whatever this file imports is compiled into the built app.
 */

/** `~/Library/Application Support/<App>`, where the agent keeps its port and lock too. */
const dataDir = process.env.STACKS_DESKTOP_DATA_DIR || join(homedir(), 'Library', 'Application Support', desktop.macos!.appName)

let store: History | undefined
const history = historyApi(() => (store ??= openHistory(join(dataDir, 'Browser.sqlite'))))

route.get('/api/desktop/status', () => response.json({ app: 'Browser', ok: true }))

// The agent only answers its own window (session cookie and Host check), which
// is stronger than a CSRF token, so these writes skip it.
route.get('/api/history', request => history.search(request))
route.post('/api/history', request => history.record(request)).skipCsrf()
route.delete('/api/history', request => history.forget(request)).skipCsrf()
