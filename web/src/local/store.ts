// Snapshot lifecycle: fetch /snapshot, ingest into local SQLite, notify subscribers.
import { batch, query, type Stmt } from './db'
import { clearAppBase, clearAppTz, setAppBase, setAppTz } from './dates'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Snapshot = Record<string, any>

const listeners = new Set<() => void>()
export const onChange = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
export const bump = () => listeners.forEach((fn) => fn())

export async function getMeta<T>(key: string): Promise<T | null> {
  const rows = await query<{ value: string }>('select value from meta where key = ?', [key])
  return rows[0] ? (JSON.parse(rows[0].value) as T) : null
}
export const setMetaStmt = (key: string, value: unknown): Stmt => ({
  sql: 'insert into meta(key, value) values(?, ?) on conflict(key) do update set value = excluded.value',
  bind: [key, JSON.stringify(value ?? null)],
})

let synced: boolean | null = null
/** Has a snapshot ever been ingested? (cached after first check) */
export async function isSynced() {
  synced ??= (await getMeta('synced_at')) !== null
  return synced
}

const doc = (collection: string, id: string, data: unknown): Stmt => ({
  sql: 'insert into docs(collection, id, data) values(?, ?, ?)',
  bind: [collection, id, JSON.stringify(data)],
})

async function ingest(snap: Snapshot) {
  const stmts: Stmt[] = [
    { sql: 'delete from transactions' },
    { sql: 'delete from categories' },
    { sql: 'delete from budgets' },
    { sql: 'delete from docs' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.transactions.map((t: any, i: number): Stmt => ({
      sql: `insert into transactions(id, type, amount, original_amount, original_currency, fx_rate,
              category_id, category, tags, note, occurred_on, source, user_id, paid_by, ord)
            values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bind: [t.id, t.type, Number(t.amount), t.originalAmount, t.originalCurrency, t.fxRate,
        t.categoryId, t.category, JSON.stringify(t.tags ?? []), t.note, t.occurredOn, t.source, t.userId, t.paidBy, i],
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.categories.map((c: any): Stmt => ({
      sql: 'insert into categories(id, name, kind, archived) values(?,?,?,?)',
      bind: [c.id, c.name, c.kind, c.archived ? 1 : 0],
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.budgets.map((b: any): Stmt => ({
      sql: 'insert into budgets(category_id, monthly_amount) values(?,?)',
      bind: [b.categoryId, Number(b.monthlyAmount)],
    })),
    // ponytail: the tag vocabulary rides in `docs` — a handful of {id,name} rows never need a table
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.tags.map((t: any) => doc('tags', t.id, t)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.loans.map((l: any) => doc('loans', l.id, l)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.loan_payments.map((p: any) => doc('loan_payments', p.id, p)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.accounts.map((a: any) => doc('accounts', a.id, a)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.recurring.map((r: any) => doc('recurring', r.id, r)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...snap.portfolio.holdings.map((h: any) => doc('holdings', h.holding_id, h)),
    setMetaStmt('me', snap.me),
    setMetaStmt('household', snap.household),
    setMetaStmt('zakat_settings', snap.zakat_settings),
    setMetaStmt('fx_rates', snap.fx_rates),
    setMetaStmt('etag', `"${snap.hash}"`),
    setMetaStmt('synced_at', new Date().toISOString()),
  ]
  await batch(stmts)
  if (snap.household?.timezone) setAppTz(snap.household.timezone)
  if (snap.household?.baseCurrency) setAppBase(snap.household.baseCurrency)
  synced = true
}

const pending = async () => (await query<{ c: number }>('select count(*) as c from outbox'))[0].c > 0

let refreshing: Promise<'ok' | 'unchanged' | 'unauthorized' | 'offline' | 'pending'> | null = null

/**
 * Pull the latest snapshot if it changed. Coalesces concurrent calls.
 * `fresh` waits out an in-flight pull first: after a write, the in-flight one was issued before it
 * and its response can't contain it — and since ingest rebuilds every table, joining that pull
 * would wipe the row back out of the mirror.
 */
export async function refresh(fresh = false) {
  if (fresh && refreshing) await refreshing.catch(() => undefined)
  refreshing ??= (async () => {
    try {
      // never ingest over unflushed local writes — the outbox must drain first (syncNow orders this)
      if (await pending()) return 'pending' as const
      const etag = await getMeta<string>('etag')
      const res = await fetch('/api/v1/snapshot', { headers: etag ? { 'If-None-Match': etag } : {} })
      if (res.status === 304) return 'unchanged' as const
      if (res.status === 401 || res.status === 403) return 'unauthorized' as const
      if (!res.ok) throw new Error(`snapshot ${res.status}`)
      const snap = await res.json()
      // …and re-check after the round-trip: a write made *during* the fetch isn't in this response,
      // and ingest rebuilds every table, so ingesting now would silently drop it
      if (await pending()) return 'pending' as const
      await ingest(snap)
      bump()
      return 'ok' as const
    } catch {
      return 'offline' as const
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

/** Wipe local data (sign-out / session invalid on another account). */
export async function clearLocal() {
  await batch([
    { sql: 'delete from transactions' }, { sql: 'delete from categories' }, { sql: 'delete from budgets' },
    { sql: 'delete from docs' }, { sql: 'delete from meta' }, { sql: 'delete from outbox' },
  ])
  clearAppTz()
  clearAppBase()
  synced = false
  bump()
}
