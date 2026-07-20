// Write path: apply mutations to local SQLite immediately, queue them, replay to the REST API in order.
import { toast } from 'sonner'
import { batch, query, type Stmt } from './db'
import { bump, getMeta, refresh, setMetaStmt } from './store'
import { todayPk } from './dates'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const QUEUEABLE = [
  /^\/transactions(\/|$)/, /^\/budgets\/[^/]+$/, /^\/loans(\/|$)/, /^\/holdings(\/|$)/,
  /^\/instruments\/[^/]+$/, /^\/accounts(\/|$)/, /^\/recurring(\/|$)/, /^\/zakat\/settings$/, /^\/prices$/,
]
export const isQueueable = (method: string, path: string) =>
  method !== 'GET' && QUEUEABLE.some((re) => re.test(path.split('?')[0]))

const CREATES_WITH_ID = /^\/(transactions|loans|holdings|accounts|recurring)$|^\/loans\/[^/]+\/payments$/

export async function pendingCount() {
  const [{ c }] = await query<{ c: number }>('select count(*) as c from outbox')
  return c
}

async function patchDoc(collection: string, id: string, patch: Row): Promise<Stmt[]> {
  const rows = await query<{ data: string }>('select data from docs where collection = ? and id = ?', [collection, id])
  if (!rows[0]) return []
  const merged = { ...JSON.parse(rows[0].data), ...patch }
  return [{ sql: 'update docs set data = ? where collection = ? and id = ?', bind: [JSON.stringify(merged), collection, id] }]
}

async function fxRateFor(currency?: string, explicit?: number) {
  if (!currency || currency === 'PKR') return null
  if (explicit) return explicit
  const rates = await getMeta<{ quote: string; rate: number }[]>('fx_rates')
  return rates?.find((r) => r.quote === currency)?.rate ?? null
}

/** Money fields for a local transaction row, mirroring the server's resolveMoney (fx estimated from cached rates). */
async function money(b: Row) {
  const rate = await fxRateFor(b.currency, b.fx_rate ? Number(b.fx_rate) : undefined)
  if (!b.currency || b.currency === 'PKR' || !rate)
    return { amount: Number(b.amount), originalAmount: null, originalCurrency: null, fxRate: null }
  return { amount: Number(b.amount) * rate, originalAmount: Number(b.amount), originalCurrency: b.currency, fxRate: rate }
}

/** Optimistic local application of a mutation; returns the statements to run. */
async function applyLocal(method: string, path: string, b: Row): Promise<Stmt[]> {
  const me = await getMeta<Row>('me')
  const p = path.split('?')[0]
  let m: RegExpMatchArray | null

  if (p === '/transactions' && method === 'POST') {
    const mo = await money(b)
    return [{
      sql: `insert or replace into transactions(id, type, amount, original_amount, original_currency, fx_rate,
              category_id, category, note, occurred_on, source, user_id, paid_by, ord)
            values(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bind: [b.id, b.type, mo.amount, mo.originalAmount, mo.originalCurrency, mo.fxRate,
        b.category_id ?? null, b.category ?? null, b.note ?? null, b.occurred_on ?? todayPk(),
        'api', me?.id ?? null, me?.name ?? null, -Date.now()],
    }]
  }
  if ((m = p.match(/^\/transactions\/([^/]+)$/))) {
    if (method === 'DELETE') return [{ sql: 'delete from transactions where id = ?', bind: [m[1]] }]
    const sets: string[] = []
    const binds: unknown[] = []
    if (b.amount !== undefined) {
      const mo = await money(b)
      sets.push('amount = ?', 'original_amount = ?', 'original_currency = ?', 'fx_rate = ?')
      binds.push(mo.amount, mo.originalAmount, mo.originalCurrency, mo.fxRate)
    }
    for (const [key, col] of [['type', 'type'], ['category_id', 'category_id'], ['category', 'category'], ['note', 'note'], ['occurred_on', 'occurred_on']] as const)
      if (b[key] !== undefined) { sets.push(`${col} = ?`); binds.push(b[key]) }
    return sets.length ? [{ sql: `update transactions set ${sets.join(', ')} where id = ?`, bind: [...binds, m[1]] }] : []
  }

  if ((m = p.match(/^\/budgets\/([^/]+)$/))) {
    const amount = Number(b.monthly_amount ?? 0)
    return amount === 0
      ? [{ sql: 'delete from budgets where category_id = ?', bind: [m[1]] }]
      : [{ sql: 'insert into budgets(category_id, monthly_amount) values(?,?) on conflict(category_id) do update set monthly_amount = excluded.monthly_amount', bind: [m[1], amount] }]
  }

  if (p === '/loans' && method === 'POST')
    return [{
      sql: 'insert or replace into docs(collection, id, data) values(?,?,?)',
      bind: ['loans', b.id, JSON.stringify({
        id: b.id, user_id: me?.id, counterparty: b.counterparty, direction: b.direction,
        principal: Number(b.principal), start_date: b.start_date ?? todayPk(), status: 'open',
        visibility: b.visibility ?? 'private', note: b.note ?? null,
      })],
    }]
  if ((m = p.match(/^\/loans\/([^/]+)$/)) && method === 'PATCH') return patchDoc('loans', m[1], b)
  if ((m = p.match(/^\/loans\/([^/]+)\/payments$/))) {
    const loanId = m[1]
    const stmts: Stmt[] = [{
      sql: 'insert or replace into docs(collection, id, data) values(?,?,?)',
      bind: ['loan_payments', b.id, JSON.stringify({ id: b.id, loanId, amount: Number(b.amount), paidOn: b.paid_on ?? todayPk(), note: b.note ?? null })],
    }]
    // mirror the server's auto-settle when the loan is fully repaid
    const [loanRow] = await query<{ data: string }>(`select data from docs where collection = 'loans' and id = ?`, [loanId])
    if (loanRow) {
      const loan = JSON.parse(loanRow.data)
      const payments = (await query<{ data: string }>(`select data from docs where collection = 'loan_payments'`))
        .map((r) => JSON.parse(r.data)).filter((pmt) => pmt.loanId === loanId)
      const paid = payments.reduce((s, pmt) => s + Number(pmt.amount), 0) + Number(b.amount)
      if (paid >= Number(loan.principal) && loan.status === 'open')
        stmts.push(...(await patchDoc('loans', loanId, { status: 'settled' })))
    }
    return stmts
  }

  if (p === '/holdings' && method === 'POST') {
    const cost = b.avg_cost ? Number(b.units) * Number(b.avg_cost) : null
    return [{
      sql: 'insert or replace into docs(collection, id, data) values(?,?,?)',
      bind: ['holdings', b.id, JSON.stringify({
        holding_id: b.id, instrument_id: b.instrument?.id ?? b.instrument_id ?? null, kind: b.instrument?.kind ?? null,
        symbol: b.instrument?.symbol ?? null, name: b.instrument?.name ?? '(pending sync)',
        units: Number(b.units), avg_cost: b.avg_cost != null ? Number(b.avg_cost) : null,
        zakatable: b.zakatable ?? true, visibility: b.visibility ?? 'private', note: b.note ?? null,
        price: null, price_as_of: null, price_source: null, value: null, cost, gain: null,
      })],
    }]
  }
  if ((m = p.match(/^\/holdings\/([^/]+)$/))) {
    if (method === 'DELETE') return [{ sql: `delete from docs where collection = 'holdings' and id = ?`, bind: [m[1]] }]
    const [row] = await query<{ data: string }>(`select data from docs where collection = 'holdings' and id = ?`, [m[1]])
    if (!row) return []
    const h = { ...JSON.parse(row.data), ...b }
    if (b.units === 0) return [{ sql: `delete from docs where collection = 'holdings' and id = ?`, bind: [m[1]] }]
    h.value = h.price != null ? Number(h.units) * Number(h.price) : null
    h.cost = h.avg_cost != null ? Number(h.units) * Number(h.avg_cost) : null
    h.gain = h.value != null && h.cost != null ? h.value - h.cost : null
    return [{ sql: 'update docs set data = ? where collection = ? and id = ?', bind: [JSON.stringify(h), 'holdings', m[1]] }]
  }
  if ((m = p.match(/^\/instruments\/([^/]+)$/))) {
    const rows = await query<{ id: string; data: string }>(`select id, data from docs where collection = 'holdings'`)
    return rows.filter((r) => JSON.parse(r.data).instrument_id === m![1])
      .map((r) => ({ sql: 'update docs set data = ? where collection = ? and id = ?', bind: [JSON.stringify({ ...JSON.parse(r.data), name: b.name }), 'holdings', r.id] }))
  }
  if (p === '/prices' && method === 'POST') {
    const rows = await query<{ id: string; data: string }>(`select id, data from docs where collection = 'holdings'`)
    return rows.filter((r) => JSON.parse(r.data).instrument_id === b.instrument_id).map((r) => {
      const h = JSON.parse(r.data)
      h.price = Number(b.price)
      h.price_as_of = b.as_of ?? todayPk()
      h.price_source = 'manual'
      h.value = Number(h.units) * h.price
      h.gain = h.cost != null ? h.value - h.cost : null
      return { sql: 'update docs set data = ? where collection = ? and id = ?', bind: [JSON.stringify(h), 'holdings', r.id] }
    })
  }

  if (p === '/accounts' && method === 'POST') {
    const rate = (await fxRateFor(b.currency)) ?? (b.currency && b.currency !== 'PKR' ? null : 1)
    const balance = Number(b.balance ?? 0)
    return [{
      sql: 'insert or replace into docs(collection, id, data) values(?,?,?)',
      bind: ['accounts', b.id, JSON.stringify({
        id: b.id, user_id: me?.id, name: b.name, balance, currency: b.currency ?? 'PKR',
        zakatable: b.zakatable ?? true, visibility: b.visibility ?? 'private',
        rate, rate_as_of: null, base_balance: rate != null ? Math.round(balance * rate * 100) / 100 : null,
      })],
    }]
  }
  if ((m = p.match(/^\/accounts\/([^/]+)$/)) && method === 'PATCH') {
    const [row] = await query<{ data: string }>(`select data from docs where collection = 'accounts' and id = ?`, [m[1]])
    if (!row) return []
    const a = { ...JSON.parse(row.data), ...b }
    if (b.balance !== undefined || b.currency !== undefined) {
      a.rate = a.currency === 'PKR' ? 1 : ((await fxRateFor(a.currency)) ?? a.rate)
      a.base_balance = a.rate != null ? Math.round(Number(a.balance) * a.rate * 100) / 100 : null
    }
    return [{ sql: 'update docs set data = ? where collection = ? and id = ?', bind: [JSON.stringify(a), 'accounts', m[1]] }]
  }

  if (p === '/recurring' && method === 'POST')
    return [{
      sql: 'insert or replace into docs(collection, id, data) values(?,?,?)',
      bind: ['recurring', b.id, JSON.stringify({
        id: b.id, userId: me?.id, type: b.type, amount: Number(b.amount), categoryId: null,
        description: b.description, dayOfMonth: Number(b.day_of_month), active: true, lastMaterialized: null,
      })],
    }]
  if ((m = p.match(/^\/recurring\/([^/]+)$/)) && method === 'PATCH') {
    const patch: Row = {}
    if (b.type !== undefined) patch.type = b.type
    if (b.amount !== undefined) patch.amount = Number(b.amount)
    if (b.description !== undefined) patch.description = b.description
    if (b.day_of_month !== undefined) patch.dayOfMonth = Number(b.day_of_month)
    if (b.active !== undefined) patch.active = b.active
    return patchDoc('recurring', m[1], patch)
  }

  if (p === '/zakat/settings') {
    const cur = (await getMeta<Row>('zakat_settings')) ?? {}
    return [setMetaStmt('zakat_settings', {
      ...cur,
      nisabAmount: b.nisab_amount ?? cur.nisabAmount,
      nextDueDate: b.next_due_date ?? cur.nextDueDate ?? null,
    })]
  }

  return [] // queued for replay even when there's no local projection to update
}

/** Commit a mutation locally + queue it, then try to sync. Returns the (id-stamped) body. */
export async function mutate(method: string, path: string, body?: unknown) {
  const b: Row = { ...((body as Row) ?? {}) }
  if (method === 'POST' && CREATES_WITH_ID.test(path.split('?')[0]) && !b.id) b.id = crypto.randomUUID()
  // inline-created instruments get a client id too, so rename/price work before first sync
  if (method === 'POST' && path.split('?')[0] === '/holdings' && b.instrument && !b.instrument.id)
    b.instrument = { ...b.instrument, id: crypto.randomUUID() }
  const stmts = await applyLocal(method, path, b)
  stmts.push({
    sql: 'insert into outbox(method, path, body, created_at) values(?,?,?,?)',
    bind: [method, path, JSON.stringify(b), new Date().toISOString()],
  })
  await batch(stmts)
  bump()
  void syncNow()
  return b
}

let flushing: Promise<void> | null = null

function flushOutbox() {
  flushing ??= (async () => {
    try {
      for (;;) {
        const [row] = await query<{ seq: number; method: string; path: string; body: string }>(
          'select seq, method, path, body from outbox order by seq limit 1')
        if (!row) break
        let res: Response
        try {
          res = await fetch(`/api/v1${row.path}`, {
            method: row.method,
            headers: { 'content-type': 'application/json' },
            body: row.method === 'DELETE' ? undefined : row.body,
          })
        } catch {
          break // offline — keep the queue, retry on reconnect
        }
        if (res.status === 401 || res.status === 403) break // signed out — never drop entries over auth
        if (!res.ok && res.status >= 500) break // server trouble — retry later
        if (!res.ok) toast.error(`A change could not sync (${res.status}) and was undone`)
        await batch([{ sql: 'delete from outbox where seq = ?', bind: [row.seq] }])
      }
    } finally {
      flushing = null
    }
  })()
  return flushing
}

/** Drain the outbox, then pull the latest snapshot (refresh skips ingest while entries remain). */
export async function syncNow() {
  await flushOutbox()
  const result = await refresh()
  bump() // pending badge updates even when nothing else changed
  return result
}
