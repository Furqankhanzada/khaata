import { describe, expect, it } from 'vitest'
import { getApp, inviteCodeOf, json, makeUser, mcp, req } from '../helpers'

describe('snapshot', () => {
  it('bundles per-user data and hides other members private wealth', async () => {
    const a = await makeUser()
    const b = await makeUser({ inviteCode: await inviteCodeOf(a) })
    await json('/api/v1/tags', { key: a.key, json: { name: 'milk' } })
    await json('/api/v1/transactions', { key: a.key, json: { type: 'expense', amount: 250, category: 'Groceries', note: 'snap milk', tags: ['milk'] } })
    await mcp(a.key, 'tools/call', {
      name: 'add_holding',
      arguments: { instrument: { kind: 'other', name: 'Private Gold' }, units: 2, visibility: 'private' },
    })

    const snapB = await json<any>('/api/v1/snapshot', { key: b.key })
    expect(snapB.me.id).toBe(b.userId)
    expect(snapB.household.members).toHaveLength(2)
    expect(snapB.transactions.map((t: any) => t.note)).toContain('snap milk')
    expect(snapB.categories.length).toBeGreaterThan(0)
    // the local mirror needs both the vocabulary and the tags on each row
    expect(snapB.tags.map((t: any) => t.name)).toContain('milk')
    expect(snapB.transactions.find((t: any) => t.note === 'snap milk').tags).toEqual(['milk'])
    expect(JSON.stringify(snapB.portfolio)).not.toContain('Private Gold')

    const snapA = await json<any>('/api/v1/snapshot', { key: a.key })
    expect(JSON.stringify(snapA.portfolio)).toContain('Private Gold')
    expect(snapA.hash).not.toBe(snapB.hash)
  })

  it('supports ETag revalidation with 304', async () => {
    const u = await makeUser()
    const res = await req('/api/v1/snapshot', { key: u.key })
    const etag = res.headers.get('etag')
    expect(etag).toBeTruthy()

    const app = await getApp()
    const res304 = await app.request('/api/v1/snapshot', { headers: { 'x-api-key': u.key, 'If-None-Match': etag! } })
    expect(res304.status).toBe(304)

    await json('/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: 10, category: 'Other' } })
    const resChanged = await app.request('/api/v1/snapshot', { headers: { 'x-api-key': u.key, 'If-None-Match': etag! } })
    expect(resChanged.status).toBe(200)
  })

  it('creates with a client id are idempotent (transactions + loans)', async () => {
    const u = await makeUser()
    const txId = crypto.randomUUID()
    const body = { id: txId, type: 'expense', amount: 99, category: 'Other', note: 'dupe check' }
    const r1 = await json<any>('/api/v1/transactions', { key: u.key, json: body })
    const r2 = await json<any>('/api/v1/transactions', { key: u.key, json: body })
    expect(r1.id).toBe(txId)
    expect(r2.id).toBe(txId)
    const list = await json<any[]>('/api/v1/transactions', { key: u.key })
    expect(list.filter((t) => t.note === 'dupe check')).toHaveLength(1)

    const loanId = crypto.randomUUID()
    const loanBody = { id: loanId, counterparty: 'Ahmed', direction: 'lent', principal: 5000 }
    await json('/api/v1/loans', { key: u.key, json: loanBody })
    const dupe = await json<any>('/api/v1/loans', { key: u.key, json: loanBody })
    expect(dupe.id).toBe(loanId)
    const loanList = await json<any[]>('/api/v1/loans', { key: u.key })
    expect(loanList.filter((l) => l.counterparty === 'Ahmed')).toHaveLength(1)
  })
})
