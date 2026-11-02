import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createCipheriv, createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { arcApi, previewArc } from '../../../app/Desktop/arc'
import { chromiumCookieKey, countArcCookies, decryptCookieValue, readArcCookies } from '../../../app/Desktop/arc-cookies'
import type { ArcSignIns, CookieStore } from '../../../resources/functions/browser/onboarding'
import { createImportClient, keepSignedIn, signInOffer, signInSummary } from '../../../resources/functions/browser/onboarding'

const SECRET = 'fixture-secret'
// The real clock: the route reads cookies against it, so a fixed date would expire the fixtures.
const NOW = Date.now()
/** Chromium time: microseconds since 1601. */
const chromium = (ms: number) => (ms + 11_644_473_600_000) * 1000

const cleanup: Array<() => void> = []
afterEach(() => { for (const done of cleanup.splice(0)) done() })

/** What Chromium writes: `v10` + AES-128-CBC, with SHA-256(host) first from database version 24. */
function encrypt(value: string, host: string, hashPrefixed: boolean): Buffer {
  const cipher = createCipheriv('aes-128-cbc', chromiumCookieKey(SECRET), Buffer.alloc(16, 0x20))
  const plain = Buffer.concat([hashPrefixed ? createHash('sha256').update(host).digest() : Buffer.alloc(0), Buffer.from(value)])
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain), cipher.final()])
}

interface Row { host: string, name: string, value?: string, secret?: string, expires?: number, secure?: boolean, httpOnly?: boolean, sameSite?: number, partition?: string, wrongHost?: string }

function cookiesDb(file: string, version: number, rows: Row[]) {
  const db = new Database(file)
  db.exec('CREATE TABLE meta (key TEXT, value TEXT); CREATE TABLE cookies (host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, has_expires INTEGER, is_persistent INTEGER, samesite INTEGER)')
  db.query('INSERT INTO meta VALUES (\'version\', ?)').run(String(version))
  const add = db.query('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, \'/\', ?, ?, ?, ?, ?, ?)')
  for (const row of rows) {
    const encrypted = row.secret === undefined ? Buffer.alloc(0) : encrypt(row.secret, row.wrongHost ?? row.host, version >= 24)
    add.run(row.host, row.partition ?? '', row.name, row.value ?? '', encrypted, row.expires === undefined ? 0 : chromium(row.expires), row.secure ? 1 : 0, row.httpOnly ? 1 : 0, row.expires === undefined ? 0 : 1, row.expires === undefined ? 0 : 1, row.sameSite ?? -1)
  }
  db.close()
}

/** A folder shaped like ~/Library/Application Support/Arc with two profiles' cookies and one profile without. */
function arcFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'browser-arc-cookies-test-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const later = NOW + 86_400_000
  mkdirSync(join(dir, 'User Data', 'Default'), { recursive: true })
  cookiesDb(join(dir, 'User Data', 'Default', 'Cookies'), 24, [
    { host: '.github.com', name: 'user_session', secret: 'gh-token', expires: later, secure: true, httpOnly: true, sameSite: 1 },
    { host: 'github.com', name: 'tz', value: 'Europe%2FBerlin' },
    { host: '.example.com', name: 'old', secret: 'gone', expires: NOW - 1000 },
    { host: '.embed.example', name: 'chips', secret: 'p', expires: later, partition: 'https://site.example' },
    { host: '.moved.example', name: 'swapped', secret: 'bound elsewhere', expires: later, wrongHost: '.other.example' },
  ])
  mkdirSync(join(dir, 'User Data', 'Profile 1'), { recursive: true })
  cookiesDb(join(dir, 'User Data', 'Profile 1', 'Cookies'), 23, [
    { host: '.work.example', name: 'sid', secret: 'work-session', expires: later, sameSite: 2 },
  ])
  mkdirSync(join(dir, 'User Data', 'System Profile'), { recursive: true })
  return dir
}

describe('reading Arc\'s sign-ins', () => {
  it('decrypts Chromium values, checking the host they are bound to', () => {
    const key = chromiumCookieKey(SECRET)
    expect(decryptCookieValue(encrypt('v', 'a.example', true), key, 'a.example', true)).toBe('v')
    expect(decryptCookieValue(encrypt('v', 'a.example', false), key, 'a.example', false)).toBe('v')
    expect(decryptCookieValue(encrypt('v', 'b.example', true), key, 'a.example', true)).toBeNull()
    expect(decryptCookieValue(encrypt('v', 'a.example', false), chromiumCookieKey('wrong'), 'a.example', false)).toBeNull()
    expect(decryptCookieValue(Buffer.from('v11xxxxxxxxxxxxxxxx'), key, 'a.example', false)).toBeNull()
  })

  it('keeps live cookies per profile and leaves expired, partitioned and unbound ones', () => {
    const { profiles, skipped } = readArcCookies(arcFolder(), SECRET, NOW)
    expect(skipped).toBe(3)
    expect(profiles.map(each => each.profile)).toEqual(['default', 'Profile 1'])
    const github = profiles[0]!.cookies
    expect(github).toEqual([
      { name: 'user_session', value: 'gh-token', domain: '.github.com', path: '/', expires: NOW + 86_400_000, secure: true, httpOnly: true, sameSite: 'lax' },
      { name: 'tz', value: 'Europe%2FBerlin', domain: 'github.com', path: '/', secure: false, httpOnly: false },
    ])
    expect(profiles[1]!.cookies).toEqual([{ name: 'sid', value: 'work-session', domain: '.work.example', path: '/', expires: NOW + 86_400_000, secure: false, httpOnly: false, sameSite: 'strict' }])
  })

  it('counts what would be kept without the Keychain', () => {
    expect(countArcCookies(arcFolder(), NOW)).toEqual({ cookies: 4, sites: 3 })
  })

  it('never changes Arc\'s own files', () => {
    const dir = arcFolder()
    const file = join(dir, 'User Data', 'Default', 'Cookies')
    const before = readFileSync(file)
    readArcCookies(dir, SECRET, NOW)
    countArcCookies(dir, NOW)
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('says how many sign-ins the import preview could keep', () => {
    expect(previewArc(arcFolder()).signIns?.cookies).toBeGreaterThan(0)
  })
})

describe('the sign-in route', () => {
  it('answers 403 with the reason when the Keychain refuses', async () => {
    const routes = arcApi(() => { throw new Error('no history needed') }, arcFolder, async () => { throw new Error('The Keychain did not allow reading Arc\'s sign-ins.') })
    const response = await routes.cookies()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'The Keychain did not allow reading Arc\'s sign-ins.' })
  })

  it('answers the decrypted sign-ins once allowed', async () => {
    const routes = arcApi(() => { throw new Error('no history needed') }, arcFolder, async () => SECRET)
    const body = await (await routes.cookies()).json() as { data: ArcSignIns }
    expect(body.data.profiles.map(each => each.profile)).toEqual(['default', 'Profile 1'])
  })
})

describe('keeping sign-ins in the window', () => {
  const signIns: ArcSignIns = {
    profiles: [
      { profile: 'default', cookies: [{ name: 'a', value: '1', domain: '.github.com' }, { name: 'b', value: '2', domain: 'github.com' }, { name: 'c', value: '3', domain: '.news.example' }] },
      { profile: 'Profile 1', cookies: [{ name: 'd', value: '4', domain: '.work.example' }] },
      { profile: 'Profile 9', cookies: [{ name: 'e', value: '5', domain: '.unused.example' }] },
    ],
    skipped: 0,
  }

  it('fills only the profiles a space uses, and counts sites once', async () => {
    const calls: string[] = []
    const store: CookieStore = { setCookies: async ({ profile, cookies }) => { calls.push(profile); return { set: cookies.length, skipped: 0 } } }
    expect(await keepSignedIn(signIns, store, ['Profile 1'])).toEqual({ cookies: 4, sites: 3 })
    expect(calls).toEqual(['default', 'Profile 1'])
  })

  it('says what happened in words', () => {
    expect(signInSummary({ sites: 42 })).toBe('You stay signed in to 42 sites.')
    expect(signInSummary({ sites: 0 })).toBe('Arc had no sign-ins to keep.')
    expect(signInOffer({ sites: 1 })).toBe('Stay signed in to 1 site? macOS asks you to allow reading Arc\'s sign-ins from your Keychain.')
  })

  it('passes the agent\'s reason through when the sign-ins could not be read', async () => {
    const refused = createImportClient({ base: '', fetch: async () => Response.json({ error: 'The Keychain did not allow reading Arc\'s sign-ins.' }, { status: 403 }) })
    expect(await refused.signIns()).toEqual({ error: 'The Keychain did not allow reading Arc\'s sign-ins.' })
    const offline = createImportClient({ base: '', fetch: async () => { throw new Error('offline') } })
    expect(await offline.signIns()).toEqual({ error: 'Arc\'s sign-ins could not be read.' })
    const sent: string[] = []
    const allowed = createImportClient({ base: 'http://agent', fetch: async (url, init) => { sent.push(`${init?.method} ${url}`); return Response.json({ data: signIns }) } })
    expect((await allowed.signIns()).data?.profiles).toHaveLength(3)
    expect(sent).toEqual(['POST http://agent/api/import/arc/cookies'])
  })
})
