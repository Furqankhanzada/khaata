import { describe, expect, it } from 'vitest'
import { getApp, json, mcp, req } from '../helpers'

/** Create a user whose household uses the given base currency. */
async function makeUserWith(base: string) {
  const app = await getApp()
  const email = `cur-${crypto.randomUUID().slice(0, 8)}@test.local`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password: 'password-123', name: 'Cur Tester' }),
  })
  const cookie = (res.headers.get('set-cookie') ?? '').match(/([^,;\s]*better-auth[^=]*=[^;]+)/)![1]
  await json('/api/v1/household', { cookie, json: { name: `home-${email}`, timezone: 'Asia/Karachi', base_currency: base } })
  const keyRes = await json<{ key: string }>('/api/auth/api-key/create', { cookie, json: { name: 'cur' } })
  return { cookie, key: keyRes.key }
}

describe('household base currency', () => {
  it('is required and validated at creation', async () => {
    const app = await getApp()
    const email = `cur-${crypto.randomUUID().slice(0, 8)}@test.local`
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: 'password-123', name: 'C' }),
    })
    const cookie = (res.headers.get('set-cookie') ?? '').match(/([^,;\s]*better-auth[^=]*=[^;]+)/)![1]
    expect((await req('/api/v1/household', { cookie, json: { name: 'h', timezone: 'Asia/Karachi' } })).status).toBe(400)
    expect((await req('/api/v1/household', { cookie, json: { name: 'h', timezone: 'Asia/Karachi', base_currency: 'XYZ' } })).status).toBe(400)
  })

  it('is immutable: PATCH cannot change it', async () => {
    const u = await makeUserWith('USD')
    await req('/api/v1/household', { key: u.key, method: 'PATCH', json: { base_currency: 'EUR', name: 'renamed' } })
    const snap = await json<{ household: { baseCurrency: string; name: string } }>('/api/v1/snapshot', { key: u.key })
    expect(snap.household.baseCurrency).toBe('USD') // unknown key stripped, base untouched
    expect(snap.household.name).toBe('renamed')
  })

  it('USD household: base entries store unconverted, foreign entries convert to USD', async () => {
    const u = await makeUserWith('USD')
    const plain = await json<{ amount: string; originalCurrency: string | null }>(
      '/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: 50, category: 'Other' } })
    expect(Number(plain.amount)).toBe(50)
    expect(plain.originalCurrency).toBeNull()

    const foreign = await json<{ amount: string; originalAmount: string; originalCurrency: string; fxRate: string }>(
      '/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: 100, currency: 'EUR', fx_rate: 1.1, category: 'Other' } })
    expect(Number(foreign.amount)).toBeCloseTo(110)
    expect(foreign.originalCurrency).toBe('EUR')
    expect(Number(foreign.fxRate)).toBeCloseTo(1.1)
  })

  it('USD household: accounts default to USD and convert others at recorded rates', async () => {
    const u = await makeUserWith('USD')
    await json('/api/v1/fx/rates', { key: u.key, json: { currency: 'PKR', rate: 0.0036 } })
    const acc = await json<{ currency: string }>('/api/v1/accounts', { key: u.key, json: { name: 'Checking', balance: 1000 } })
    expect(acc.currency).toBe('USD')
    await json('/api/v1/accounts', { key: u.key, json: { name: 'PK cash', balance: 100000, currency: 'PKR' } })
    const list = await json<{ name: string; base_balance: number | null }[]>('/api/v1/accounts', { key: u.key })
    const pk = list.find((a) => a.name === 'PK cash')!
    expect(pk.base_balance).toBeCloseTo(360)
  })

  it('snapshot carries the base and its fx rates', async () => {
    const u = await makeUserWith('USD')
    await json('/api/v1/fx/rates', { key: u.key, json: { currency: 'EUR', rate: 1.1 } })
    const snap = await json<{ household: { baseCurrency: string }; fx_rates: { quote: string; rate: number }[] }>(
      '/api/v1/snapshot', { key: u.key })
    expect(snap.household.baseCurrency).toBe('USD')
    expect(snap.fx_rates.find((r) => r.quote === 'EUR')?.rate).toBeCloseTo(1.1)
  })

  it('manual price valuations record in the household base and value the portfolio directly', async () => {
    const u = await makeUserWith('USD')
    await mcp(u.key, 'tools/call', {
      name: 'add_holding',
      arguments: { instrument: { kind: 'other', name: 'Gold coin' }, units: 2, visibility: 'private' },
    })
    const snap = await json<{ portfolio: { holdings: { instrument_id: string }[] } }>('/api/v1/snapshot', { key: u.key })
    const instrumentId = snap.portfolio.holdings[0].instrument_id
    await json('/api/v1/prices', { key: u.key, json: { instrument_id: instrumentId, price: 2500 } })
    const pf = await json<{ total_value: number }>('/api/v1/portfolio', { key: u.key })
    expect(pf.total_value).toBeCloseTo(5000) // 2 units × $2500, no conversion
  })
})
