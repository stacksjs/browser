import { describe, expect, it } from 'bun:test'
import { createHistoryClient } from '../../../resources/functions/browser/history-client'

function fakeAgent(answer: unknown = { data: [] }) {
  const sent: Array<{ url: string, body?: any }> = []
  const fetch = async (url: string, init?: RequestInit) => {
    sent.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) })
    return Response.json(answer)
  }
  return { sent, fetch }
}

describe('history client', () => {
  it('records a visit once a new address finishes loading, and a title that comes later', async () => {
    const agent = fakeAgent()
    const client = createHistoryClient({ base: 'http://127.0.0.1:4000/', fetch: agent.fetch, flushAfter: 60_000, now: () => 7 })
    client.report({ tab: 'a', url: 'https://a.com/', loading: true })
    client.report({ tab: 'a', url: 'https://a.com/', loading: false })
    client.report({ tab: 'a', url: 'https://a.com/', loading: false })
    client.report({ tab: 'a', url: 'https://a.com/', title: 'Alpha', loading: false })
    client.report({ tab: 'b', url: 'about:blank', loading: false })
    await client.flush()
    expect(agent.sent).toEqual([{ url: 'http://127.0.0.1:4000/api/history', body: { visits: [{ url: 'https://a.com/', at: 7 }], titles: [{ url: 'https://a.com/', title: 'Alpha' }] } }])
    await client.flush()
    expect(agent.sent).toHaveLength(1)
  })

  it('counts a reopened tab again, and never a private one', async () => {
    const agent = fakeAgent()
    const client = createHistoryClient({ base: '', fetch: agent.fetch, flushAfter: 60_000, now: () => 1, isPrivate: tab => tab === 'p' })
    client.report({ tab: 'a', url: 'https://a.com/', loading: false })
    client.forgetTab('a')
    client.report({ tab: 'a', url: 'https://a.com/', loading: false })
    client.report({ tab: 'p', url: 'https://secret.com/', loading: false })
    await client.flush()
    expect(agent.sent[0]!.body.visits.map((visit: { url: string }) => visit.url)).toEqual(['https://a.com/', 'https://a.com/'])
  })

  it('sends waiting visits before searching, and turns pages into command-bar candidates', async () => {
    const agent = fakeAgent({ data: [{ url: 'https://github.com/', title: 'GitHub', frecency: 300, lastVisitAt: 1 }] })
    const client = createHistoryClient({ base: '', fetch: agent.fetch, flushAfter: 60_000 })
    client.report({ tab: 'a', url: 'https://github.com/', loading: false })
    const found = await client.search(' git hub ', 5)
    expect(agent.sent.map(each => each.url)).toEqual(['/api/history', '/api/history?q=git%20hub&limit=5'])
    expect(found).toEqual([{ kind: 'history', id: 'https://github.com/', title: 'GitHub', url: 'https://github.com/', frecency: 300 }])
    expect(await client.search('   ')).toEqual([])
  })

  it('answers nothing, quietly, when the agent cannot', async () => {
    const client = createHistoryClient({ base: '', fetch: async () => { throw new Error('offline') } })
    client.report({ tab: 'a', url: 'https://a.com/', loading: false })
    expect(await client.search('a.com')).toEqual([])
    await client.flush()
  })
})
