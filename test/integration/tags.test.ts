import { describe, expect, it } from 'vitest'
import { json, mcp, makeUser, req, today } from '../helpers'

const month = today().slice(0, 7)

describe('tags', () => {
  it('separates "spent on meat" from a free-text search for chicken', async () => {
    const u = await makeUser()
    for (const name of ['meat', 'chicken', 'fruit'])
      await json('/api/v1/tags', { key: u.key, json: { name } })

    const grocery = await json('/api/v1/transactions', {
      key: u.key,
      json: { type: 'expense', amount: 1800, category: 'Groceries', note: 'chicken breast 1kg', tags: ['meat', 'chicken'] },
    })
    expect(grocery.tags).toEqual(['meat', 'chicken'])
    await json('/api/v1/transactions', {
      key: u.key,
      json: { type: 'expense', amount: 950, category: 'Dining out', note: 'chicken burger' },
    })

    // the whole point: the tag filter is exact, the text search is not
    const meat = await json('/api/v1/transactions?tags=meat', { key: u.key })
    expect(meat).toHaveLength(1)
    expect(meat[0].id).toBe(grocery.id)
    expect(await json('/api/v1/transactions?q=chicken', { key: u.key })).toHaveLength(2)

    // multiple tags narrow (contains all), they don't widen
    expect(await json('/api/v1/transactions?tags=meat,chicken', { key: u.key })).toHaveLength(1)
    expect(await json('/api/v1/transactions?tags=meat,fruit', { key: u.key })).toHaveLength(0)
  })

  it('rejects tags outside the vocabulary and says which are valid', async () => {
    const u = await makeUser()
    await json('/api/v1/tags', { key: u.key, json: { name: 'meat' } })

    const res = await req('/api/v1/transactions', {
      key: u.key, json: { type: 'expense', amount: 100, tags: ['meats'] },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('meats')
    expect(body.error).toContain('meat') // the valid list, for the caller to correct itself
    expect(await json('/api/v1/transactions', { key: u.key })).toHaveLength(0)
  })

  it('matches tags case-insensitively and never duplicates one', async () => {
    const u = await makeUser()
    const first = await json('/api/v1/tags', { key: u.key, json: { name: 'meat' } })
    const again = await json('/api/v1/tags', { key: u.key, json: { name: 'Meat' } })
    expect(again.id).toBe(first.id)
    expect(await json('/api/v1/tags', { key: u.key })).toHaveLength(1)

    const tx = await json('/api/v1/transactions', {
      key: u.key, json: { type: 'expense', amount: 100, tags: ['MEAT'] },
    })
    expect(tx.tags).toEqual(['meat']) // stored canonically, not as typed
  })

  it('leaves tags alone on an unrelated edit and clears them on []', async () => {
    const u = await makeUser()
    await json('/api/v1/tags', { key: u.key, json: { name: 'milk' } })
    const tx = await json('/api/v1/transactions', {
      key: u.key, json: { type: 'expense', amount: 400, tags: ['milk'] },
    })

    const repriced = await json(`/api/v1/transactions/${tx.id}`, { method: 'PATCH', key: u.key, json: { amount: 450 } })
    expect(repriced.tags).toEqual(['milk'])

    const cleared = await json(`/api/v1/transactions/${tx.id}`, { method: 'PATCH', key: u.key, json: { tags: [] } })
    expect(cleared.tags).toEqual([])
  })

  it('breaks the month down by tag, overlapping where an entry carries two', async () => {
    const u = await makeUser()
    for (const name of ['meat', 'chicken', 'fruit'])
      await json('/api/v1/tags', { key: u.key, json: { name } })
    await json('/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: 1800, tags: ['meat', 'chicken'] } })
    await json('/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: 2200, tags: ['meat'] } })
    await json('/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: 500, tags: ['fruit'] } })

    const report = await json(`/api/v1/reports/monthly?month=${month}`, { key: u.key })
    const total = (tag: string) => report.by_tag.find((r: { tag: string }) => r.tag === tag)?.total
    expect(total('meat')).toBe(4000)
    expect(total('chicken')).toBe(1800) // also inside meat's 4000 — overlap is intended
    expect(total('fruit')).toBe(500)
    expect(report.expense).toBe(4500) // by_tag deliberately doesn't sum to this
  })

  it('exposes the vocabulary and tagging over MCP', async () => {
    const u = await makeUser()
    await mcp(u.key, 'tools/call', { name: 'add_tag', arguments: { name: 'meat' } })
    const tags = await mcp(u.key, 'tools/call', { name: 'list_tags', arguments: {} })
    expect(JSON.parse(tags.body.result.content[0].text)[0].name).toBe('meat')

    await mcp(u.key, 'tools/call', {
      name: 'add_transaction', arguments: { type: 'expense', amount: 1200, tags: ['meat'] },
    })
    const listed = await mcp(u.key, 'tools/call', { name: 'list_transactions', arguments: { tags: ['meat'] } })
    const rows = JSON.parse(listed.body.result.content[0].text)
    expect(rows).toHaveLength(1)
    expect(rows[0].tags).toEqual(['meat'])

    // the correction hint has to reach the agent, not just REST clients
    const bad = await mcp(u.key, 'tools/call', {
      name: 'add_transaction', arguments: { type: 'expense', amount: 50, tags: ['meats'] },
    })
    const text = JSON.stringify(bad.body)
    expect(text).toContain('unknown tag')
    expect(text).toContain('meat')
  })
})
