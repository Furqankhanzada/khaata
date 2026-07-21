import { describe, expect, it } from 'vitest'
import { inviteCodeOf, json, makeUser, req } from '../helpers'

describe('transactions', () => {
  it('adds, lists, filters, updates and deletes', async () => {
    const u = await makeUser()
    const tx = await json('/api/v1/transactions', {
      key: u.key,
      json: { type: 'expense', amount: 2500, category: 'Groceries', note: 'weekly run', occurred_on: '2026-07-01' },
    })
    expect(tx.amount).toBe('2500.00')
    expect(tx.category).toBe('Groceries')

    await json('/api/v1/transactions', { key: u.key, json: { type: 'income', amount: 100000, category: 'Salary' } })

    const expenses = await json('/api/v1/transactions?type=expense', { key: u.key })
    expect(expenses).toHaveLength(1)
    const search = await json('/api/v1/transactions?q=weekly', { key: u.key })
    expect(search).toHaveLength(1)

    const updated = await json(`/api/v1/transactions/${tx.id}`, { method: 'PATCH', key: u.key, json: { amount: 3000 } })
    expect(updated.amount).toBe('3000.00')

    await json(`/api/v1/transactions/${tx.id}`, { method: 'DELETE', key: u.key })
    expect((await req(`/api/v1/transactions/${tx.id}`, { key: u.key })).status).toBe(404)
  })

  it('q searches notes, tags and payer names; user_id scopes to a member', async () => {
    const a = await makeUser({ name: 'Furqan' })
    const b = await makeUser({ inviteCode: await inviteCodeOf(a), name: 'Ayesha' })
    await json('/api/v1/tags', { key: a.key, json: { name: 'vegetable' } })
    await json('/api/v1/transactions', { key: a.key, json: { type: 'expense', amount: 100, category: 'Groceries', note: 'tomato', tags: ['vegetable'] } })
    await json('/api/v1/transactions', { key: b.key, json: { type: 'expense', amount: 200, category: 'Groceries', note: 'lemon' } })

    const byTag = await json<any[]>('/api/v1/transactions?q=vegetable', { key: a.key })
    expect(byTag.map((t) => t.note)).toEqual(['tomato'])
    const byPayer = await json<any[]>('/api/v1/transactions?q=ayesha', { key: a.key })
    expect(byPayer.map((t) => t.note)).toEqual(['lemon'])
    const byNote = await json<any[]>('/api/v1/transactions?q=toma', { key: a.key })
    expect(byNote.map((t) => t.note)).toEqual(['tomato'])

    const bId = byPayer[0].userId
    const scoped = await json<any[]>(`/api/v1/transactions?user_id=${bId}`, { key: a.key })
    expect(scoped.map((t) => t.note)).toEqual(['lemon'])
  })

  it('auto-creates unknown categories by name', async () => {
    const u = await makeUser()
    const tx = await json('/api/v1/transactions', {
      key: u.key, json: { type: 'expense', amount: 100, category: 'Gardening' },
    })
    expect(tx.category).toBe('Gardening')
    const cats = await json('/api/v1/categories', { key: u.key })
    expect(cats.some((c: { name: string }) => c.name === 'Gardening')).toBe(true)
  })

  it('converts foreign entries once at entry with an explicit rate', async () => {
    const u = await makeUser()
    const tx = await json('/api/v1/transactions', {
      key: u.key, json: { type: 'expense', amount: 20, currency: 'USD', fx_rate: 280, category: 'Other' },
    })
    expect(tx.amount).toBe('5600.00')
    expect(tx.originalAmount).toBe('20.00')
    expect(tx.originalCurrency).toBe('USD')
    expect(Number(tx.fxRate)).toBe(280)

    // re-passing amount with a new rate recomputes; plain PKR amount clears the original
    const rerated = await json(`/api/v1/transactions/${tx.id}`, {
      method: 'PATCH', key: u.key, json: { amount: 10, currency: 'USD', fx_rate: 300 },
    })
    expect(rerated.amount).toBe('3000.00')

    const plain = await json(`/api/v1/transactions/${tx.id}`, { method: 'PATCH', key: u.key, json: { amount: 750 } })
    expect(plain.amount).toBe('750.00')
    expect(plain.originalCurrency).toBeNull()
  })

  it('rejects invalid input', async () => {
    const u = await makeUser()
    expect((await req('/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: -5 } })).status).toBe(400)
    expect((await req('/api/v1/transactions', { key: u.key, json: { type: 'stuff', amount: 5 } })).status).toBe(400)
  })
})
