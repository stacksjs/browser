/**
 * Boosts, as Arc had them: a site's own CSS and JS, and elements "zapped" off
 * it for good. They run in an isolated world the site's scripts cannot see
 * (craft.web.setUserScripts), beside the ad blocker's page scripts.
 */

import type { UserScript } from './blocker'

export interface Boost {
  id: string
  /** The site, as `siteKey` names it; covers its subdomains. */
  host: string
  name: string
  css: string
  js: string
  /** Selectors of elements zapped off the site. */
  zapped: string[]
  enabled: boolean
}

export function newBoost(host: string, id: string): Boost {
  return { id, host, name: `${host} Boost`, css: '', js: '', zapped: [], enabled: true }
}

/** Each enabled boost as the user scripts that carry it: its CSS with the zapped elements hidden, and its JS. */
export function boostScripts(boosts: Boost[]): UserScript[] {
  return boosts.filter(boost => boost.enabled).flatMap((boost) => {
    const hidden = boost.zapped.length ? `${boost.zapped.join(',\n')} { display: none !important; }` : ''
    const css = [boost.css.trim(), hidden].filter(Boolean).join('\n')
    const scripts: UserScript[] = []
    if (css) scripts.push({ id: `boost:${boost.id}:css`, hosts: [boost.host], css })
    if (boost.js.trim()) scripts.push({ id: `boost:${boost.id}:js`, hosts: [boost.host], js: boost.js })
    return scripts
  })
}

/**
 * A selector for one element that survives a reload: its id when it has a
 * stable one, else its tag and classes, anchored by the nearest ancestor with
 * an id and `:nth-of-type` where siblings would tie. Runs in the page.
 */
export function selectorFor(element: Element): string {
  const stable = (value: string) => /^[a-z][\w-]{1,63}$/i.test(value) && !/\d{4,}/.test(value)
  const parts: string[] = []
  let node: Element | null = element
  while (node && node.nodeType === 1 && node !== node.ownerDocument.documentElement) {
    if (node.id && stable(node.id)) { parts.unshift(`#${CSS.escape(node.id)}`); break }
    let part = node.tagName.toLowerCase()
    const classes = [...node.classList].filter(stable).slice(0, 3)
    if (classes.length) part += classes.map(name => `.${CSS.escape(name)}`).join('')
    const parent: Element | null = node.parentElement
    if (parent) {
      const same = [...parent.children].filter(child => child.tagName === node!.tagName)
      if (same.length > 1 && !classes.length) part += `:nth-of-type(${same.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = parent
    if (parts.length >= 5) break
  }
  return parts.join(' > ')
}

/**
 * The page side of zapping, injected into the isolated world: the element
 * under the pointer is outlined, a click hides it and records its selector in
 * `window.__craftZapped` (which the window reads), and Escape stops.
 */
export const ZAP_SCRIPT = `(() => {
  if (window.__craftZap) return
  const selectorFor = ${selectorFor.toString()}
  window.__craftZapped = window.__craftZapped || []
  let outlined = null
  const outline = (element) => {
    if (outlined) outlined.style.removeProperty('outline')
    outlined = element
    if (element) element.style.setProperty('outline', '2px solid #3b5bfd', 'important')
  }
  const move = (event) => outline(event.target)
  const click = (event) => {
    event.preventDefault(); event.stopPropagation()
    const target = event.target
    outline(null)
    window.__craftZapped.push(selectorFor(target))
    target.style.setProperty('display', 'none', 'important')
  }
  const key = (event) => { if (event.key === 'Escape') stop() }
  const stop = () => {
    outline(null)
    document.removeEventListener('mousemove', move, true)
    document.removeEventListener('click', click, true)
    document.removeEventListener('keydown', key, true)
    window.__craftZap = null
  }
  document.addEventListener('mousemove', move, true)
  document.addEventListener('click', click, true)
  document.addEventListener('keydown', key, true)
  window.__craftZap = { stop }
})()`

/** Read what was zapped so far, and stop zapping when `stop`. */
export const zapReadScript = (stop: boolean): string => `(() => { const zapped = window.__craftZapped || []; window.__craftZapped = []; ${stop ? 'window.__craftZap && window.__craftZap.stop();' : ''} return JSON.stringify(zapped) })()`

/** Boosts over the agent. */
export function createBoostClient(options: { base: string, fetch?: (input: string, init?: RequestInit) => Promise<Response> }) {
  const send = options.fetch ?? ((input, init) => fetch(input, init))
  const base = options.base.replace(/\/+$/, '')
  return {
    async all(): Promise<Boost[]> {
      try {
        const response = await send(`${base}/api/boosts`)
        return response.ok ? ((await response.json()) as { data: Boost[] }).data : []
      }
      catch { return [] }
    },
    async save(boost: Boost): Promise<void> {
      try { await send(`${base}/api/boosts`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(boost) }) }
      catch {}
    },
    async remove(id: string): Promise<void> {
      try { await send(`${base}/api/boosts?id=${encodeURIComponent(id)}`, { method: 'DELETE' }) }
      catch {}
    },
  }
}
