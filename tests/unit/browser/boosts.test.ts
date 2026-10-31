import { afterEach, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { releaseOrm } from '@stacksjs/query-builder'
import { boostFrom, boostsApi, createBoosts } from '../../../app/Desktop/boosts'
import { openBrowserDatabase } from '../../../app/Desktop/database'
import { boostScripts, createBoostClient, newBoost, ZAP_SCRIPT, zapReadScript } from '../../../resources/functions/browser/boosts'
import { shouldPeek } from '../../../resources/functions/browser/peek'
import { addFavorite, createState, openTab, pinTab } from '../../../resources/functions/browser/sidebar'

const open: Database[] = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
  releaseOrm()
})

describe('boosts', () => {
  it('carry their CSS with zapped elements hidden, and their JS, only while enabled', () => {
    const boost = { ...newBoost('news.example', 'b1'), css: 'body { font-size: 18px }', zapped: ['#cookie', 'aside.promo'], js: 'console.log(1)' }
    expect(boostScripts([boost])).toEqual([
      { id: 'boost:b1:css', hosts: ['news.example'], css: 'body { font-size: 18px }\n#cookie,\naside.promo { display: none !important; }' },
      { id: 'boost:b1:js', hosts: ['news.example'], js: 'console.log(1)' },
    ])
    expect(boostScripts([{ ...boost, enabled: false }])).toEqual([])
    expect(boostScripts([newBoost('empty.example', 'b2')])).toEqual([])
  })

  it('zap with a page script that parses, read back once', () => {
    expect(() => new Function(ZAP_SCRIPT)).not.toThrow()
    expect(() => new Function(zapReadScript(true))).not.toThrow()
    expect(zapReadScript(true)).toContain('stop()')
  })

  it('are kept by the agent', async () => {
    const db = openBrowserDatabase(':memory:')
    open.push(db)
    const routes = boostsApi(() => createBoosts(db))
    const client = createBoostClient({ base: '', fetch: async (url, init) => {
      const request = new Request(`http://x${url}`, init)
      return request.method === 'PUT' ? routes.save(request) : request.method === 'DELETE' ? routes.remove(request) : routes.all()
    } })
    await client.save({ ...newBoost('a.example', 'a'), zapped: ['#x'] })
    await client.save(newBoost('b.example', 'b'))
    expect((await client.all()).map(boost => `${boost.id}:${boost.zapped.length}`)).toEqual(['a:1', 'b:0'])
    await client.remove('a')
    expect((await client.all()).map(boost => boost.id)).toEqual(['b'])
    expect(boostFrom({ ...newBoost('Bad Host', 'x') })).toBeNull()
  })
})

describe('peek', () => {
  it('opens links out of pinned tabs and favorites to other sites, never out of Today', () => {
    let state = createState({ id: 's' })
    for (const id of ['mail', 'chat', 'news']) state = openTab(state, { id, url: `https://${id}.example/`, now: 1 }).state
    state = pinTab(state, 'mail')
    state = addFavorite(state, 'chat')
    expect(shouldPeek(state, 'mail', 'https://elsewhere.example/a')).toBe(true)
    expect(shouldPeek(state, 'chat', 'https://elsewhere.example/a')).toBe(true)
    expect(shouldPeek(state, 'mail', 'https://www.mail.example/inbox')).toBe(false)
    expect(shouldPeek(state, 'news', 'https://elsewhere.example/a')).toBe(false)
  })
})
