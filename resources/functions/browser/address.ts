/**
 * What the address bar and the command bar make of what was typed, and how a
 * page's address reads in the sidebar's pill.
 */

export type SearchEngineName = 'google' | 'duckduckgo' | 'kagi' | 'bing' | 'ecosia' | 'brave'

/** `%s` is where the query goes. */
export const SEARCH_ENGINES: Record<SearchEngineName, { name: string, search: string, suggest?: string }> = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  kagi: { name: 'Kagi', search: 'https://kagi.com/search?q=%s', suggest: 'https://kagi.com/api/autosuggest?q=%s' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  ecosia: { name: 'Ecosia', search: 'https://www.ecosia.org/search?q=%s', suggest: 'https://ac.ecosia.org/autocomplete?type=list&q=%s' },
  brave: { name: 'Brave', search: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
}

export type Resolved = { kind: 'url', url: string } | { kind: 'search', url: string, query: string }

const SCHEME = /^[a-z][a-z\d+.-]*:/i
const HOST_PORT = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:]+\])(?::\d{1,5})?(?:[/?#].*)?$/i
const DOMAIN = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z][a-z\d-]{1,62}\.?(?::\d{1,5})?(?:[/?#].*)?$/i

/** An address when it looks like one (a scheme, a domain, localhost or an IP), a search otherwise. */
export function resolveInput(input: string, engine: SearchEngineName = 'google'): Resolved | null {
  const text = input.trim()
  if (!text) return null
  // `stacksjs.com:8080` has a "scheme" to a URL parser; a real scheme is followed by `//` or is a known non-web one.
  const looksLikeHostPort = /^[^\s/:]+:\d+(?:[/?#]|$)/.test(text)
  if (SCHEME.test(text) && !looksLikeHostPort && !/\s/.test(text))
    return { kind: 'url', url: text }
  if (!/\s/.test(text)) {
    if (HOST_PORT.test(text)) return { kind: 'url', url: `http://${text}` }
    if (DOMAIN.test(text)) return { kind: 'url', url: `https://${text}` }
  }
  return { kind: 'search', query: text, url: searchURL(text, engine) }
}

export function searchURL(query: string, engine: SearchEngineName = 'google'): string {
  return SEARCH_ENGINES[engine].search.replace('%s', encodeURIComponent(query))
}

/** The host the pill shows: `stacksjs.com` for `https://www.stacksjs.com/docs`, the scheme's own name for the rest. */
export function displayHost(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      return parsed.hostname.replace(/^www\./, '')
    if (parsed.protocol === 'file:') return decodeURIComponent(parsed.pathname.split('/').pop() || 'File')
    return parsed.protocol.replace(/:$/, '')
  }
  catch {
    return url
  }
}

/** A tab's label: its title, else its host, else the address as typed. */
export function displayTitle(title: string | undefined, url: string | undefined): string {
  const trimmed = title?.trim()
  if (trimmed) return trimmed
  return url ? displayHost(url) : 'New Tab'
}

/** Two addresses are the same page when only a trailing slash or the fragment differ. */
export function samePage(a: string, b: string): boolean {
  const normal = (url: string) => url.replace(/#.*$/, '').replace(/\/$/, '')
  return normal(a) === normal(b)
}
