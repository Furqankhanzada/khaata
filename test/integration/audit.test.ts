import { describe, expect, it } from 'vitest'
import { inviteCodeOf, json, makeUser, mcp, req } from '../helpers'
import { eq } from 'drizzle-orm'
import { db } from '../../src/db/client'
import { auditLog } from '../../src/db/schema'
import { audit, purgeAuditLog } from '../../src/services/audit'

const rowsFor = (userId: string) => db.select().from(auditLog).where(eq(auditLog.userId, userId))

describe('audit log', () => {
  it('records MCP mutations with actor and args', async () => {
    const u = await makeUser()
    await mcp(u.key, 'tools/call', {
      name: 'add_transaction',
      arguments: { type: 'expense', amount: 500, category: 'Groceries', note: 'audit me' },
    })
    const rows = await rowsFor(u.userId)
    const entry = rows.find((r) => r.channel === 'mcp')
    expect(entry).toBeDefined()
    expect(entry!.action).toBe('add_transaction')
    expect(entry!.householdId).toBeTruthy()
    expect(entry!.detail).toMatchObject({ amount: 500, note: 'audit me' })
  })

  it('records REST mutations with the row id in the action path', async () => {
    const u = await makeUser()
    const tx = await json('/api/v1/transactions', { key: u.key, json: { type: 'expense', amount: 100, category: 'Other' } })
    await req(`/api/v1/transactions/${tx.id}`, { key: u.key, method: 'PATCH', json: { amount: 150 } })
    const actions = (await rowsFor(u.userId)).map((r) => r.action)
    expect(actions).toContain('POST /api/v1/transactions')
    expect(actions).toContain(`PATCH /api/v1/transactions/${tx.id}`)
  })

  it('does not record reads', async () => {
    const u = await makeUser()
    await mcp(u.key, 'tools/call', { name: 'list_transactions', arguments: {} })
    await json('/api/v1/transactions', { key: u.key })
    const rows = await rowsFor(u.userId)
    // only the household creation from makeUser is audited
    expect(rows.map((r) => r.action)).toEqual(['POST /api/v1/household'])
  })

  it('does not record failed mutations', async () => {
    const u1 = await makeUser()
    const u2 = await makeUser()
    const tx = await json('/api/v1/transactions', { key: u1.key, json: { type: 'expense', amount: 100, category: 'Other' } })
    const res = await req(`/api/v1/transactions/${tx.id}`, { key: u2.key, method: 'DELETE' })
    expect(res.status).toBe(404)
    const actions = (await rowsFor(u2.userId)).map((r) => r.action)
    expect(actions).toEqual(['POST /api/v1/household'])
  })

  it('viewer: shared actions visible household-wide, wealth actions only to their actor', async () => {
    const a = await makeUser()
    const b = await makeUser({ inviteCode: await inviteCodeOf(a) })
    await mcp(a.key, 'tools/call', {
      name: 'add_transaction',
      arguments: { type: 'expense', amount: 10, category: 'Other', note: 'shared spend' },
    })
    await mcp(a.key, 'tools/call', {
      name: 'add_holding',
      arguments: { instrument: { kind: 'other', name: 'Secret Gold' }, units: 1, visibility: 'private' },
    })

    const bCall = await mcp(b.key, 'tools/call', { name: 'get_audit_log', arguments: {} })
    const bView = JSON.parse(bCall.body.result.content[0].text) as { action: string; actor: string }[]
    const bActions = bView.map((r) => r.action)
    expect(bActions).toContain('add_transaction')
    expect(bActions).not.toContain('add_holding')

    const aView = await json<{ action: string; actor: string }[]>('/api/v1/audit', { key: a.key })
    expect(aView.map((r) => r.action)).toContain('add_holding')
    expect(aView.find((r) => r.action === 'add_transaction')!.actor).toBe('Tester')
  })

  it('purge keeps 30 days and drops older rows', async () => {
    const u = await makeUser()
    await db.insert(auditLog).values({
      at: new Date(Date.now() - 31 * 86400_000),
      userId: u.userId, householdId: null, channel: 'api', action: 'OLD',
    })
    await audit({ channel: 'api', action: 'FRESH', userId: u.userId, householdId: null })
    await purgeAuditLog()
    const actions = (await rowsFor(u.userId)).map((r) => r.action)
    expect(actions).not.toContain('OLD')
    expect(actions).toContain('FRESH')
  })
})
