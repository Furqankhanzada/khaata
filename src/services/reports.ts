import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { monthBounds, todayIn } from '../util'
import { budgetStatus } from './budgets'
import type { Ctx } from '../middleware'

export async function totalsFor(householdId: string, from: string, toExclusive: string) {
  const totals = await db.execute(sql`
    select type, sum(amount)::float8 as total from transactions
    where household_id = ${householdId} and occurred_on >= ${from} and occurred_on < ${toExclusive}
    group by type`)
  const income = Number(totals.rows.find(r => r.type === 'income')?.total ?? 0)
  const expense = Number(totals.rows.find(r => r.type === 'expense')?.total ?? 0)
  return { income, expense, net: income - expense }
}

async function breakdownFor(householdId: string, from: string, toExclusive: string) {
  const byCategory = await db.execute(sql`
    select t.type, coalesce(c.name, 'Uncategorized') as category, sum(t.amount)::float8 as total
    from transactions t left join categories c on c.id = t.category_id
    where t.household_id = ${householdId} and t.occurred_on >= ${from} and t.occurred_on < ${toExclusive}
    group by t.type, c.name order by total desc`)
  const byMember = await db.execute(sql`
    select u.name as member, t.type, sum(t.amount)::float8 as total
    from transactions t join "user" u on u.id = t.user_id
    where t.household_id = ${householdId} and t.occurred_on >= ${from} and t.occurred_on < ${toExclusive}
    group by u.name, t.type order by u.name`)
  return { by_category: byCategory.rows, by_member: byMember.rows }
}

export async function monthlyReport(ctx: Ctx, month?: string) {
  const { month: m, from, toExclusive } = monthBounds(ctx.timezone, month)
  const status = await budgetStatus(ctx, m)
  return {
    month: m,
    ...(await totalsFor(ctx.householdId, from, toExclusive)),
    ...(await breakdownFor(ctx.householdId, from, toExclusive)),
    budgets: status.budgets,
    budget_totals: status.totals,
    unbudgeted_spent: status.unbudgeted_spent,
    month_elapsed_pct: status.month_elapsed_pct,
  }
}

export type Period = 'week' | 'month' | 'quarter' | 'year'

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Date range + trend bucket step for a period, `offset` periods back from the current one. */
export function periodRange(tz: string, period: Period, offset: number) {
  const [y, m, d] = todayIn(tz).split('-').map(Number)
  const today = new Date(y, m - 1, d)
  let start: Date, end: Date, label: string, step: string

  if (period === 'week') {
    start = addDays(today, -((today.getDay() + 6) % 7) + offset * 7) // ISO Monday
    end = addDays(start, 7)
    const last = addDays(end, -1)
    label = `${start.getDate()} ${MONTHS[start.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`
    step = '1 day'
  } else if (period === 'month') {
    start = addMonths(new Date(y, m - 1, 1), offset)
    end = addMonths(start, 1)
    label = `${start.toLocaleDateString('en-PK', { month: 'long' })} ${start.getFullYear()}`
    step = '7 days'
  } else if (period === 'quarter') {
    start = addMonths(new Date(y, Math.floor((m - 1) / 3) * 3, 1), offset * 3)
    end = addMonths(start, 3)
    label = `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`
    step = '1 month'
  } else {
    start = new Date(y + offset, 0, 1)
    end = new Date(y + offset + 1, 0, 1)
    label = String(start.getFullYear())
    step = '1 month'
  }
  return { from: ymd(start), toExclusive: ymd(end), label, step }
}

/** Custom inclusive date range; bucket step scales with range length. */
function customRange(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const start = new Date(fy, fm - 1, fd)
  const endIncl = new Date(ty, tm - 1, td)
  const end = addDays(endIncl, 1)
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
  const step = days <= 31 ? '1 day' : days <= 168 ? '7 days' : '1 month'
  const label =
    `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${endIncl.getDate()} ${MONTHS[endIncl.getMonth()]} ${endIncl.getFullYear()}`
  const prevStart = addDays(start, -days)
  return {
    cur: { from: ymd(start), toExclusive: ymd(end), label, step },
    prev: { from: ymd(prevStart), toExclusive: ymd(start), label: `${days} days before`, step },
  }
}

export type OverviewOpts = { period?: Period; offset?: number; from?: string; to?: string }

export async function overviewReport(ctx: Ctx, opts: OverviewOpts = {}) {
  const { period = 'month', offset = 0 } = opts
  const custom = opts.from && opts.to ? customRange(opts.from, opts.to) : null
  const cur = custom ? custom.cur : periodRange(ctx.timezone, period, offset)
  const prev = custom ? custom.prev : periodRange(ctx.timezone, period, offset - 1)

  const trend = await db.execute(sql`
    select to_char(gs.bucket, 'YYYY-MM-DD') as bucket,
           coalesce(sum(t.amount) filter (where t.type = 'income'), 0)::float8 as income,
           coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)::float8 as expense
    from generate_series(${cur.from}::date, ${cur.toExclusive}::date - 1, ${cur.step}::interval) gs(bucket)
    left join transactions t on t.household_id = ${ctx.householdId}
      and t.occurred_on >= gs.bucket::date
      and t.occurred_on < least((gs.bucket + ${cur.step}::interval)::date, ${cur.toExclusive}::date)
    group by gs.bucket order by gs.bucket`)

  return {
    period: custom ? 'custom' : period,
    offset,
    label: cur.label,
    from: cur.from,
    to: cur.toExclusive,
    granularity: cur.step === '1 day' ? 'day' : cur.step === '7 days' ? 'week' : 'month',
    ...(await totalsFor(ctx.householdId, cur.from, cur.toExclusive)),
    prev: { label: prev.label, ...(await totalsFor(ctx.householdId, prev.from, prev.toExclusive)) },
    trend: trend.rows,
    ...(await breakdownFor(ctx.householdId, cur.from, cur.toExclusive)),
  }
}
