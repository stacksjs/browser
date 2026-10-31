/**
 * The command bar's results: open tabs, pinned tabs, history, suggestions and
 * actions, ranked by how well they match what was typed and how much they are used.
 */

import { displayHost } from './address'

export interface Visit { at: number }

const DAY = 86_400_000

/**
 * How often and how recently a page was visited, Firefox's way: recent visits
 * weigh most, and a page last seen months ago fades without vanishing.
 */
export function frecency(visits: Visit[], now: number): number {
  const weight = (age: number) => (age < 4 * DAY ? 100 : age < 14 * DAY ? 70 : age < 31 * DAY ? 50 : age < 90 * DAY ? 30 : 10)
  // The last ten visits stand for the rest, scaled up by how many there were.
  const recent = [...visits].sort((a, b) => b.at - a.at).slice(0, 10)
  if (!recent.length) return 0
  const sampled = recent.reduce((sum, visit) => sum + weight(now - visit.at), 0)
  return Math.round(sampled / recent.length * visits.length)
}

export type ResultKind = 'tab' | 'pinned' | 'history' | 'suggestion' | 'action'

export interface Candidate {
  kind: ResultKind
  id: string
  title: string
  url?: string
  /** More words it answers to than its title shows (an action's synonyms). */
  keywords?: string
  /** For history: see `frecency`. */
  frecency?: number
}

export interface Ranked extends Candidate { score: number }

/** Lower-case words to look for: `gh pull` matches "GitHub Pull Requests". */
function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * How well one word matches a candidate: the start of its host best, then the
 * start of a word in its title, then anywhere in its title or address. Zero is
 * no match.
 */
function matchWord(word: string, title: string, url: string, host: string): number {
  if (host.startsWith(word)) return 12
  if (title.startsWith(word)) return 10
  if (new RegExp(`(?:^|[\\s\\-_./])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(title)) return 8
  if (title.includes(word)) return 5
  if (url.includes(word)) return 3
  return 0
}

const KIND_BONUS: Record<ResultKind, number> = { tab: 30, pinned: 25, action: 20, history: 0, suggestion: -10 }
const KIND_PRIORITY: Record<ResultKind, number> = { tab: 4, pinned: 3, action: 2, history: 1, suggestion: 0 }

/**
 * The best `limit` matches, every word required. An open tab ranks above the
 * same page in history, and the same address appears once.
 */
export function rank(query: string, candidates: Candidate[], limit = 8): Ranked[] {
  const wanted = words(query)
  const seen = new Map<string, Ranked>()
  for (const candidate of candidates) {
    const title = (candidate.keywords ? `${candidate.title} ${candidate.keywords}` : candidate.title).toLowerCase()
    const url = (candidate.url ?? '').toLowerCase()
    const host = candidate.url ? displayHost(candidate.url).toLowerCase() : ''
    let score = 0
    let matched = true
    for (const word of wanted) {
      const points = matchWord(word, title, url, host)
      if (!points) { matched = false; break }
      score += points
    }
    // Suggestions come from the search engine for this very query; they match by definition.
    if (!matched && candidate.kind !== 'suggestion') continue
    score += KIND_BONUS[candidate.kind] + Math.log1p(candidate.frecency ?? 0) * 6
    const ranked: Ranked = { ...candidate, score }
    const key = candidate.url ? candidate.url.replace(/#.*$/, '').replace(/\/$/, '') : `${candidate.kind}:${candidate.id}`
    // One row per page: an open tab stands for its history (switching beats reopening), with the better of their scores.
    const existing = seen.get(key)
    if (!existing) { seen.set(key, ranked); continue }
    const keep = KIND_PRIORITY[ranked.kind] > KIND_PRIORITY[existing.kind] ? ranked : existing
    seen.set(key, { ...keep, score: Math.max(existing.score, ranked.score) })
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}
