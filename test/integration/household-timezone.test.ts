import { describe, expect, it } from 'vitest'
import { getApp, json, makeUser, mcp, req } from '../helpers'

/** Create a user whose household lives in the given IANA timezone. */
async function makeUserIn(timezone: string) {
  const app = await getApp()
  const email = `tz-${crypto.randomUUID().slice(0, 8)}@test.local`
  const res = await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password: 'password-123', name: 'TZ Tester' }),
  })
  const cookie = (res.headers.get('set-cookie') ?? '').match(/([^,;\s]*better-auth[^=]*=[^;]+)/)![1]
  await json('/api/v1/household', { cookie, json: { name: `home-${email}`, timezone } })
  const keyRes = await json<{ key: string }>('/api/auth/api-key/create', { cookie, json: { name: 'tz' } })
  return { cookie, key: keyRes.key }
}

const dateIn = (tz: string) => new Date().toLocaleDateString('en-CA', { timeZone: tz })

describe('household timezone', () => {
  it('requires a valid IANA timezone at creation', async () => {
    const app = await getApp()
    const email = `tz-${crypto.randomUUID().slice(0, 8)}@test.local`
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email, password: 'password-123', name: 'T' }),
    })
    const cookie = (res.headers.get('set-cookie') ?? '').match(/([^,;\s]*better-auth[^=]*=[^;]+)/)![1]
    const missing = await req('/api/v1/household', { cookie, json: { name: 'no-tz-home' } })
    expect(missing.status).toBe(400)
    const invalid = await req('/api/v1/household', { cookie, json: { name: 'bad-tz-home', timezone: 'Mars/Olympus' } })
    expect(invalid.status).toBe(400)
  })

  it("entry default dates follow the household's calendar, not the server's", async () => {
    // Etc/GMT+12 (UTC-12) and Etc/GMT-14 (UTC+14) straddle every moment — they never agree on the date
    const west = await makeUserIn('Etc/GMT+12')
    const east = await makeUserIn('Etc/GMT-14')
    const w = await json<{ occurredOn: string }>('/api/v1/transactions', { key: west.key, json: { type: 'expense', amount: 5, category: 'Other' } })
    const e = await json<{ occurredOn: string }>('/api/v1/transactions', { key: east.key, json: { type: 'expense', amount: 5, category: 'Other' } })
    expect(w.occurredOn).toBe(dateIn('Etc/GMT+12'))
    expect(e.occurredOn).toBe(dateIn('Etc/GMT-14'))
    expect(w.occurredOn).not.toBe(e.occurredOn)
  })

  it('timezone is changeable via PATCH and the MCP tool, and rides the snapshot', async () => {
    const u = await makeUser()
    const snap = await json<{ household: { timezone: string } }>('/api/v1/snapshot', { key: u.key })
    expect(snap.household.timezone).toBe('Asia/Karachi')

    const patched = await json<{ timezone: string }>('/api/v1/household', { key: u.key, method: 'PATCH', json: { timezone: 'Asia/Dubai' } })
    expect(patched.timezone).toBe('Asia/Dubai')

    const r = await mcp(u.key, 'tools/call', { name: 'update_household', arguments: { timezone: 'Europe/London' } })
    expect(JSON.parse(r.body.result.content[0].text).timezone).toBe('Europe/London')

    const bad = await req('/api/v1/household', { key: u.key, method: 'PATCH', json: { timezone: 'Not/AZone' } })
    expect(bad.status).toBe(400)
  })
})
