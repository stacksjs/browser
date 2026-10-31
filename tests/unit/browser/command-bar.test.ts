import { describe, expect, it } from 'bun:test'
import { createSuggestions, parseSuggestions, suggestApi } from '../../../app/Desktop/suggest'
import { ACTIONS, actionCandidates } from '../../../resources/functions/browser/actions'
import { commandIds } from '../../../resources/functions/browser/keymap'
import { rank } from '../../../resources/functions/browser/rank'
import { createSuggestionClient } from '../../../resources/functions/browser/suggestions'

describe('command bar actions', () => {
  it('are found by title or by the words people use, and the page ones only with a page', () => {
    const all = actionCandidates(true)
    expect(rank('copy', all, 3)[0]!.id).toBe('copy-url')
    expect(rank('incognito', all, 3)[0]!.id).toBe('new-private-window')
    expect(rank('preferences', all, 3)[0]!.id).toBe('settings')
    expect(actionCandidates(false).some(action => action.id === 'copy-url')).toBe(false)
  })

  it('name commands the menus also send, or ones the window handles itself', () => {
    const menus = new Set(commandIds())
    const windowOnly = new Set(['site-controls', 'settings', 'set-default-browser'])
    expect(ACTIONS.filter(action => !menus.has(action.command) && !windowOnly.has(action.command))).toEqual([])
  })
})

describe('search suggestions', () => {
  it('read an OpenSearch answer and nothing else', () => {
    expect(parseSuggestions(['arc', ['arc browser', 'arc', 3, '']])).toEqual(['arc browser', 'arc'])
    expect(parseSuggestions({ nope: true })).toEqual([])
  })

  it('come from the engine once per query for a while, minus the query itself', async () => {
    const asked: string[] = []
    let clock = 0
    const suggest = createSuggestions({
      now: () => clock,
      fetch: async (url) => { asked.push(url); return Response.json(['arc', ['arc', 'arc browser', 'arc search']]) },
    })
    expect(await suggest('Arc')).toEqual(['arc browser', 'arc search'])
    expect(await suggest('arc ')).toEqual(['arc browser', 'arc search'])
    expect(asked).toHaveLength(1)
    expect(asked[0]).toStartWith('https://suggestqueries.google.com/')
    clock = 11 * 60_000
    await suggest('arc', 'duckduckgo')
    expect(asked[1]).toStartWith('https://duckduckgo.com/ac/')
  })

  it('answer nothing when the engine is slow, down or unknown', async () => {
    const slow = createSuggestions({ timeoutMs: 20, fetch: (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))) })
    expect(await slow('arc')).toEqual([])
    const down = createSuggestions({ fetch: async () => new Response('no', { status: 503 }) })
    expect(await down('arc')).toEqual([])
    expect(await down('arc', 'altavista' as never)).toEqual([])
  })

  it('reach the window as searches through the agent', async () => {
    const routes = suggestApi(createSuggestions({ fetch: async () => Response.json(['x', ['x ray']]) }))
    const client = createSuggestionClient({ base: '', fetch: async url => routes.get(new Request(`http://127.0.0.1${url}`)) })
    expect(await client('x')).toEqual([{ kind: 'suggestion', id: 'suggest:x ray', title: 'x ray', url: 'https://www.google.com/search?q=x%20ray' }])
  })
})
