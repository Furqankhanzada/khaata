import { describe, expect, it } from 'vitest'
import { inviteCodeOf, json, makeUser, mcp, req } from '../helpers'

describe('accounts', () => {
  it('full CRUD via REST', async () => {
    const u = await makeUser()
    const acc = await json<{ id: string }>('/api/v1/accounts', { key: u.key, json: { name: 'Meezan', balance: 1000 } })
    const patched = await json<{ name: string }>(`/api/v1/accounts/${acc.id}`, {
      key: u.key, method: 'PATCH', json: { name: 'Meezan Savings', balance: 2500, zakatable: false },
    })
    expect(patched.name).toBe('Meezan Savings')

    const [row] = await json<{ balance: number; zakatable: boolean }[]>('/api/v1/accounts', { key: u.key })
    expect(row.balance).toBe(2500)
    expect(row.zakatable).toBe(false)

    expect((await req(`/api/v1/accounts/${acc.id}`, { key: u.key, method: 'DELETE' })).status).toBe(200)
    expect(await json<unknown[]>('/api/v1/accounts', { key: u.key })).toHaveLength(0)
  })

  it('delete_account MCP tool removes the account', async () => {
    const u = await makeUser()
    const acc = await json<{ id: string }>('/api/v1/accounts', { key: u.key, json: { name: 'Cash', balance: 10 } })
    const r = await mcp(u.key, 'tools/call', { name: 'delete_account', arguments: { id: acc.id } })
    expect(JSON.parse(r.body.result.content[0].text)).toEqual({ deleted: true })
    expect(await json<unknown[]>('/api/v1/accounts', { key: u.key })).toHaveLength(0)
  })

  it('privacy: private accounts 404 for other members, shared ones are editable', async () => {
    const a = await makeUser()
    const b = await makeUser({ inviteCode: await inviteCodeOf(a) })
    const priv = await json<{ id: string }>('/api/v1/accounts', { key: a.key, json: { name: 'Private stash', balance: 500, visibility: 'private' } })
    const shared = await json<{ id: string }>('/api/v1/accounts', { key: a.key, json: { name: 'Family cash', balance: 300, visibility: 'shared' } })

    expect((await req(`/api/v1/accounts/${priv.id}`, { key: b.key, method: 'PATCH', json: { balance: 1 } })).status).toBe(404)
    expect((await req(`/api/v1/accounts/${priv.id}`, { key: b.key, method: 'DELETE' })).status).toBe(404)

    const upd = await json<{ balance: string }>(`/api/v1/accounts/${shared.id}`, { key: b.key, method: 'PATCH', json: { balance: 350 } })
    expect(Number(upd.balance)).toBe(350)
    expect((await req(`/api/v1/accounts/${shared.id}`, { key: b.key, method: 'DELETE' })).status).toBe(200)
  })
})
