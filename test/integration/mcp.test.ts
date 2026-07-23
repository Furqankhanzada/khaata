import { describe, expect, it } from 'vitest'
import { json, makeUser, mcp } from '../helpers'

describe('MCP endpoint', () => {
  it('rejects calls without a key', async () => {
    const r = await mcp(null, 'tools/list')
    expect(r.status).toBe(401)
  })

  it('initializes and lists the full toolset', async () => {
    const u = await makeUser()
    const init = await mcp(u.key, 'initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' },
    })
    expect(init.body.result.serverInfo.name).toBe('hamara-hisaab')

    const list = await mcp(u.key, 'tools/list')
    const names = list.body.result.tools.map((t: { name: string }) => t.name)
    expect(names.length).toBeGreaterThanOrEqual(28)
    for (const required of ['add_transaction', 'get_report', 'get_zakat_summary', 'update_loan', 'record_fx_rate']) {
      expect(names).toContain(required)
    }
  })

  it('executes tools against the caller household', async () => {
    const u = await makeUser()
    const call = await mcp(u.key, 'tools/call', {
      name: 'add_transaction',
      arguments: { type: 'expense', amount: 1200, category: 'Food & Dining', note: 'via MCP' },
    })
    const payload = JSON.parse(call.body.result.content[0].text)
    expect(payload.amount).toBe('1200.00')

    const txs = await json('/api/v1/transactions', { key: u.key })
    expect(txs).toHaveLength(1)

    // foreign entry through MCP too
    const fx = await mcp(u.key, 'tools/call', {
      name: 'add_transaction',
      arguments: { type: 'expense', amount: 20, currency: 'USD', fx_rate: 280, category: 'Other' },
    }, 2)
    expect(JSON.parse(fx.body.result.content[0].text).amount).toBe('5600.00')
  })

  it('advertises tool annotations by convention', async () => {
    const u = await makeUser()
    const list = await mcp(u.key, 'tools/list')
    const by = Object.fromEntries(list.body.result.tools.map((t: { name: string; annotations?: Record<string, boolean> }) => [t.name, t.annotations]))
    expect(by.list_transactions).toMatchObject({ readOnlyHint: true, openWorldHint: false })
    expect(by.delete_transaction).toMatchObject({ destructiveHint: true })
    expect(by.update_loan).toMatchObject({ idempotentHint: true })
    expect(by.refresh_prices).toMatchObject({ openWorldHint: true })
  })

  it('paginates list_transactions with total_count', async () => {
    const u = await makeUser()
    for (let i = 0; i < 3; i++) {
      await mcp(u.key, 'tools/call', { name: 'add_transaction', arguments: { type: 'expense', amount: 100, category: 'Food' } }, 10 + i)
    }
    const page = await mcp(u.key, 'tools/call', { name: 'list_transactions', arguments: { limit: 2, offset: 0 } }, 20)
    const p = JSON.parse(page.body.result.content[0].text)
    expect(p.items).toHaveLength(2)
    expect(p.total_count).toBe(3)
    expect(p.has_more).toBe(true)
    expect(p.next_offset).toBe(2)

    const last = await mcp(u.key, 'tools/call', { name: 'list_transactions', arguments: { limit: 2, offset: 2 } }, 21)
    const l = JSON.parse(last.body.result.content[0].text)
    expect(l.items).toHaveLength(1)
    expect(l.has_more).toBe(false)
    expect(l.next_offset).toBeNull()
  })

  it('returns isError for a not-found update instead of a raw error', async () => {
    const u = await makeUser()
    const r = await mcp(u.key, 'tools/call', {
      name: 'update_transaction',
      arguments: { id: '00000000-0000-0000-0000-000000000000', note: 'x' },
    })
    expect(r.body.result.isError).toBe(true)
    expect(r.body.result.content[0].text).toContain('not found')
  })

  it('catches a handler throw as isError, not a transport crash', async () => {
    const u = await makeUser()
    // add_holding with an instrument that omits the required symbol makes the service throw
    const r = await mcp(u.key, 'tools/call', {
      name: 'add_holding',
      arguments: { units: 1, avg_cost: 10, instrument: { kind: 'stock', name: 'No Symbol Co' } },
    })
    expect(r.body.result.isError).toBe(true)
    expect(r.body.result.content[0].text).toContain('symbol')
  })
})
