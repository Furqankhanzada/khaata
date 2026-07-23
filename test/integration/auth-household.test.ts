import { describe, expect, it } from 'vitest'
import { inviteCodeOf, json, makeUser, req } from '../helpers'

describe('auth + household', () => {
  it('registers, creates a household, and authenticates via session and API key', async () => {
    const u = await makeUser()
    const meCookie = await json('/api/v1/me', { cookie: u.cookie })
    expect(meCookie.user.email).toBe(u.email)
    expect(meCookie.household).not.toBeNull()

    const meKey = await json('/api/v1/me', { key: u.key })
    expect(meKey.user.id).toBe(u.userId)
  })

  it('seeds a new household with the default expense categories, incl. Family Support and Gifts', async () => {
    const u = await makeUser()
    const cats = await json('/api/v1/categories', { key: u.key })
    const expense = cats.filter((c: { kind: string }) => c.kind === 'expense').map((c: { name: string }) => c.name)
    expect(expense).toEqual(expect.arrayContaining(['Family Support', 'Gifts', 'Groceries']))
  })

  it('rejects bad API keys and missing auth', async () => {
    expect((await req('/api/v1/me', { key: 'not-a-key' })).status).toBe(401)
    expect((await req('/api/v1/transactions')).status).toBe(401)
  })

  it('spouse joins via invite code and shares the ledger', async () => {
    const a = await makeUser({ name: 'A' })
    const b = await makeUser({ inviteCode: await inviteCodeOf(a), name: 'B' })

    await json('/api/v1/transactions', { key: b.key, json: { type: 'expense', amount: 500, category: 'Groceries' } })
    const seenByA = await json('/api/v1/transactions', { key: a.key })
    expect(seenByA).toHaveLength(1)
    expect(seenByA[0].paidBy).toBe('B')

    const h = await json('/api/v1/household', { cookie: a.cookie })
    expect(h.members).toHaveLength(2)
  })

  it('rejects an invalid invite code', async () => {
    const res = await req('/api/auth/sign-up/email', {
      json: { email: `x-${Date.now()}@test.local`, password: 'password-123', name: 'X' },
    })
    const cookie = res.headers.get('set-cookie')!.match(/([^,;\s]*better-auth[^=]*=[^;]+)/)![1]
    const join = await req('/api/v1/household', { cookie, json: { invite_code: 'nope' } })
    expect(join.status).toBe(404)
  })

  it('seeds default categories including Phone/Internet and Bills/Taxes', async () => {
    const u = await makeUser()
    const cats = await json('/api/v1/categories', { key: u.key })
    const names = cats.map((c: { name: string }) => c.name)
    expect(names).toContain('Groceries')
    expect(names).toContain('Phone/Internet')
    expect(names).toContain('Bills/Taxes')
  })
})
