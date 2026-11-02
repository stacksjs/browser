import { Database } from 'bun:sqlite'
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromiumTime } from '../../resources/functions/browser/arc-import'

/**
 * Keeping a person signed in when they move from Arc: its cookies, read from a
 * copy of each profile's Chromium `Cookies` database and decrypted with the key
 * Arc keeps in the login Keychain ("Arc Safe Storage"). Reading that key is the
 * one step macOS asks the person to allow, so nothing here runs until they
 * choose to keep their sign-ins; the preview only counts.
 *
 * Chromium on macOS stores each value as `v10` + AES-128-CBC, keyed by
 * PBKDF2-SHA1(secret, "saltysalt", 1003 rounds), with an IV of sixteen spaces.
 * From database version 24 the plaintext starts with SHA-256(host), which binds
 * a value to its site and is checked here before it is dropped.
 */

/** A cookie as `craft.web.setCookies` takes it. */
export interface ImportedCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: 'lax' | 'strict' | 'none'
}

export interface ArcCookies {
  /** Per Arc profile, under the profile name this browser's spaces use (`default` for Arc's Default). */
  profiles: Array<{ profile: string, cookies: ImportedCookie[] }>
  /** Expired, partitioned (WebKit's store cannot hold a partition) or undecryptable cookies left behind. */
  skipped: number
}

export interface ArcCookieCount {
  cookies: number
  sites: number
}

interface CookieRow {
  host_key: string
  name: string
  value: string
  encrypted_value: Uint8Array | null
  path: string
  expires_utc: number
  is_secure: number
  is_httponly: number
  has_expires: number
  samesite: number
  top_frame_site_key: string | null
}

const SAME_SITE: Record<number, ImportedCookie['sameSite']> = { 0: 'none', 1: 'lax', 2: 'strict' }

/** The AES key Chromium derives from the Keychain secret. */
export function chromiumCookieKey(secret: string): Buffer {
  return pbkdf2Sync(secret, 'saltysalt', 1003, 16, 'sha1')
}

/** One stored value in plain text, or null when it is not one this key opens. */
export function decryptCookieValue(encrypted: Uint8Array, key: Buffer, host: string, hashPrefixed: boolean): string | null {
  const bytes = Buffer.from(encrypted)
  if (bytes.subarray(0, 3).toString('latin1') !== 'v10') return null
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    const plain = Buffer.concat([decipher.update(bytes.subarray(3)), decipher.final()])
    if (!hashPrefixed) return plain.toString('utf8')
    if (plain.length < 32 || !plain.subarray(0, 32).equals(createHash('sha256').update(host).digest())) return null
    return plain.subarray(32).toString('utf8')
  }
  catch { return null }
}

/** Arc's profile folders (`User Data/Default`, `User Data/Profile 1`, ...) that hold cookies. */
function profileFolders(dir: string): Array<{ folder: string, profile: string }> {
  const userData = join(dir, 'User Data')
  if (!existsSync(userData)) return []
  return readdirSync(userData, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(userData, entry.name, 'Cookies')))
    .map(entry => ({ folder: join(userData, entry.name), profile: entry.name === 'Default' ? 'default' : entry.name }))
    .sort((a, b) => a.profile === 'default' ? -1 : b.profile === 'default' ? 1 : a.profile.localeCompare(b.profile))
}

/** Reads a copy of one `Cookies` database (with its write-ahead log), so Arc's own file is never opened. */
function withCopy<T>(folder: string, read: (db: Database) => T): T {
  const temp = mkdtempSync(join(tmpdir(), 'browser-arc-cookies-'))
  try {
    copyFileSync(join(folder, 'Cookies'), join(temp, 'Cookies'))
    if (existsSync(join(folder, 'Cookies-wal'))) copyFileSync(join(folder, 'Cookies-wal'), join(temp, 'Cookies-wal'))
    const db = new Database(join(temp, 'Cookies'))
    try { return read(db) }
    finally { db.close() }
  }
  finally { rmSync(temp, { recursive: true, force: true }) }
}

const live = (row: { has_expires: number, expires_utc: number }, now: number) => !row.has_expires || chromiumTime(row.expires_utc) > now

/** How many sign-ins an import would keep, without the Keychain (nothing is decrypted). */
export function countArcCookies(dir: string, now = Date.now()): ArcCookieCount {
  const hosts = new Set<string>()
  let cookies = 0
  for (const { folder } of profileFolders(dir)) {
    withCopy(folder, (db) => {
      for (const row of db.query<Pick<CookieRow, 'host_key' | 'has_expires' | 'expires_utc' | 'top_frame_site_key'>, []>('SELECT host_key, has_expires, expires_utc, top_frame_site_key FROM cookies').all()) {
        if (!live(row, now) || row.top_frame_site_key) continue
        cookies++
        hosts.add(row.host_key.replace(/^\./, ''))
      }
    })
  }
  return { cookies, sites: hosts.size }
}

/** Every live, unpartitioned cookie of every Arc profile, decrypted with `secret`. */
export function readArcCookies(dir: string, secret: string, now = Date.now()): ArcCookies {
  const key = chromiumCookieKey(secret)
  let skipped = 0
  const profiles = profileFolders(dir).map(({ folder, profile }) => withCopy(folder, (db) => {
    const version = Number(db.query<{ value: string }, []>('SELECT value FROM meta WHERE key = \'version\'').get()?.value ?? 0)
    const cookies: ImportedCookie[] = []
    for (const row of db.query<CookieRow, []>('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, samesite, top_frame_site_key FROM cookies').all()) {
      if (!live(row, now) || row.top_frame_site_key) { skipped++; continue }
      const value = row.value || (row.encrypted_value?.length ? decryptCookieValue(row.encrypted_value, key, row.host_key, version >= 24) : '')
      if (value === null) { skipped++; continue }
      const sameSite = SAME_SITE[row.samesite]
      cookies.push({
        name: row.name,
        value,
        domain: row.host_key,
        path: row.path || '/',
        ...(row.has_expires ? { expires: chromiumTime(row.expires_utc) } : {}),
        secure: row.is_secure === 1,
        httpOnly: row.is_httponly === 1,
        ...(sameSite ? { sameSite } : {}),
      })
    }
    return { profile, cookies }
  })).filter(each => each.cookies.length)
  return { profiles, skipped }
}

/**
 * Arc's cookie key from the login Keychain. macOS shows its own prompt for
 * this, naming Arc's item, and the person decides; a refusal comes back as an
 * error rather than a guess.
 */
export async function arcSafeStorageSecret(): Promise<string> {
  const child = Bun.spawn(['/usr/bin/security', 'find-generic-password', '-w', '-s', 'Arc Safe Storage', '-a', 'Arc'], { stdout: 'pipe', stderr: 'pipe' })
  const [code, out] = await Promise.all([child.exited, new Response(child.stdout).text()])
  if (code !== 0 || !out.trim()) throw new Error('The Keychain did not allow reading Arc\'s sign-ins.')
  return out.trim()
}
