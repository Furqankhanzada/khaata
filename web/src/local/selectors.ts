// Local read router: serves the same shapes as the REST endpoints, from local SQLite.
// Returns undefined for paths it doesn't own (or before first sync) — api() then hits the network.
import { query } from './db'
import { getMeta, isSynced } from './store'
import { buckets, customRange, monthBounds, periodRange, todayApp, type Period } from './dates'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

const docs = async (collection: string): Promise<Row[]> =>
  (await query<{ data: string }>('select data from docs where collection = ?', [collection])).map((r) => JSON.parse(r.data))

async function totalsFor(from: string, toExclusive: string) {
  const rows = await query<Row>(
    `select type, sum(amount) as total from transactions where occurred_on >= ? and occurred_on < ? group by type`,
    [from, toExclusive])
  const income = Number(rows.find((r) => r.type === 'income')?.total ?? 0)
  const expense = Number(rows.find((r) => r.type === 'expense')?.total ?? 0)
  return { income, expense, net: income - expense }
}

async function breakdownFor(from: string, toExclusive: string) {
  const by_category = await query<Row>(
    `select type, coalesce(category, 'Uncategorized') as category, sum(amount) as total
     from transactions where occurred_on >= ? and occurred_on < ?
     group by type, category order by total desc`, [from, toExclusive])
  const by_member = await query<Row>(
    `select paid_by as member, type, sum(amount) as total
     from transactions where occurred_on >= ? and occurred_on < ?
     group by paid_by, type order by paid_by`, [from, toExclusive])
  return { by_category, by_member }
}

async function budgetStatus(month?: string) {
  const { month: m, from, toExclusive } = monthBounds(month)
  const rows = await query<Row>(
    `select b.category_id, c.name as category, b.monthly_amount as budget,
            coalesce(s.spent, 0) as spent, b.monthly_amount - coalesce(s.spent, 0) as remaining
     from budgets b join categories c on c.id = b.category_id
     left join (
       select category_id, sum(amount) as spent from transactions
       where type = 'expense' and occurred_on >= ? and occurred_on < ? group by category_id
     ) s on s.category_id = b.category_id
     order by c.name`, [from, toExclusive])
  const [{ total }] = await query<Row>(
    `select coalesce(sum(amount), 0) as total from transactions
     where type = 'expense' and occurred_on >= ? and occurred_on < ?`, [from, toExclusive])
  const budget = rows.reduce((s, r) => s + r.budget, 0)
  const spent = rows.reduce((s, r) => s + r.spent, 0)
  const today = todayApp()
  let month_elapsed_pct: number | null = null
  if (today.slice(0, 7) === m) {
    const [y, mo, d] = today.split('-').map(Number)
    month_elapsed_pct = Math.round((d / new Date(y, mo, 0).getDate()) * 100)
  }
  return {
    month: m,
    budgets: rows.map((r) => ({ category_id: r.category_id, category: r.category, budget: r.budget, spent: r.spent, remaining: r.remaining })),
    totals: { budget, spent, remaining: budget - spent },
    unbudgeted_spent: Math.round((total - spent) * 100) / 100,
    month_elapsed_pct,
  }
}

const txSelect = `select id, type, amount, original_amount as originalAmount, original_currency as originalCurrency,
  fx_rate as fxRate, category_id as categoryId, category, note, occurred_on as occurredOn,
  source, user_id as userId, paid_by as paidBy from transactions`

// note: loan rows are snake_case (server raw SQL) but payment rows are camelCase (drizzle select)
function loanTotals(loan: Row, payments: Row[]): Row {
  const paid = payments.filter((p) => p.loanId === loan.id).reduce((s, p) => s + Number(p.amount), 0)
  return { ...loan, paid, outstanding: Number(loan.principal) - paid }
}

async function overview(params: URLSearchParams) {
  const period = (params.get('period') ?? 'month') as Period
  const offset = Number(params.get('offset') ?? 0)
  const custom = params.get('from') && params.get('to') ? customRange(params.get('from')!, params.get('to')!) : null
  const cur = custom ? custom.cur : periodRange(period, offset)
  const prev = custom ? custom.prev : periodRange(period, offset - 1)

  const rows = await query<Row>(
    `select occurred_on, type, amount from transactions where occurred_on >= ? and occurred_on < ?`,
    [cur.from, cur.toExclusive])
  const starts = buckets(cur)
  const trend = starts.map((bucket, i) => {
    const end = starts[i + 1] ?? cur.toExclusive
    const inBucket = rows.filter((r) => r.occurred_on >= bucket && r.occurred_on < end)
    return {
      bucket,
      income: inBucket.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0),
      expense: inBucket.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0),
    }
  })

  return {
    period: custom ? 'custom' : period,
    offset,
    label: cur.label,
    from: cur.from,
    to: cur.toExclusive,
    granularity: cur.step === '1 day' ? 'day' : cur.step === '7 days' ? 'week' : 'month',
    ...(await totalsFor(cur.from, cur.toExclusive)),
    prev: { label: prev.label, ...(await totalsFor(prev.from, prev.toExclusive)) },
    trend,
    ...(await breakdownFor(cur.from, cur.toExclusive)),
  }
}

/** Serve a GET path from local SQLite; undefined = not locally served. */
export async function localRead(path: string): Promise<unknown> {
  if (!(await isSynced())) return undefined
  const [p, qs] = path.split('?')
  const params = new URLSearchParams(qs ?? '')

  if (p === '/me') {
    const user = await getMeta('me')
    return user ? { user, household: await getMeta('household') } : undefined
  }
  if (p === '/household') return (await getMeta('household')) ?? undefined

  if (p === '/transactions') {
    const q = params.get('q')
    const limit = Number(params.get('limit') ?? 50)
    return query(
      `${txSelect}${q ? ' where note like ?' : ''} order by occurred_on desc, ord asc limit ?`,
      q ? [`%${q}%`, limit] : [limit])
  }
  const txOne = p.match(/^\/transactions\/([^/]+)$/)
  if (txOne) return (await query(`${txSelect} where id = ?`, [txOne[1]]))[0]

  if (p === '/categories') return query(`select id, name, kind from categories where archived = 0 order by kind, name`)
  if (p === '/budgets/status') return budgetStatus()
  if (p === '/reports/monthly') {
    const { month: m, from, toExclusive } = monthBounds(params.get('month') ?? undefined)
    const status = await budgetStatus(m)
    return {
      month: m,
      ...(await totalsFor(from, toExclusive)),
      ...(await breakdownFor(from, toExclusive)),
      budgets: status.budgets,
      budget_totals: status.totals,
      unbudgeted_spent: status.unbudgeted_spent,
      month_elapsed_pct: status.month_elapsed_pct,
    }
  }
  if (p === '/reports/overview') return overview(params)

  if (p === '/loans') {
    const status = params.get('status')
    const [loans, payments] = await Promise.all([docs('loans'), docs('loan_payments')])
    return loans.map((l) => loanTotals(l, payments))
      .filter((l) => !status || l.status === status)
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
  }
  const loanOne = p.match(/^\/loans\/([^/]+)$/)
  if (loanOne) {
    const [loans, payments] = await Promise.all([docs('loans'), docs('loan_payments')])
    const loan = loans.find((l) => l.id === loanOne[1])
    if (!loan) return undefined
    return {
      ...loanTotals(loan, payments),
      payments: payments.filter((pmt) => pmt.loanId === loan.id)
        .sort((a, b) => String(a.paidOn).localeCompare(String(b.paidOn))),
    }
  }

  if (p === '/portfolio') {
    const holdings = (await docs('holdings')).sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    const priced = holdings.filter((h) => h.value != null)
    const total = priced.reduce((s, h) => s + Number(h.value), 0)
    const cost = priced.reduce((s, h) => s + Number(h.cost ?? 0), 0)
    return { holdings, total_value: total, total_cost: cost, total_gain: total - cost, unpriced: holdings.length - priced.length }
  }

  if (p === '/accounts') return (await docs('accounts')).sort((a, b) => String(a.name).localeCompare(String(b.name)))
  if (p === '/recurring') return (await docs('recurring')).sort((a, b) => a.dayOfMonth - b.dayOfMonth)

  return undefined
}
