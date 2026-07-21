import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { zakatSettings } from '../db/schema'
import { monthBounds, todayIn } from '../util'
import type { Ctx } from '../middleware'
import { listTransactions, transactionFilters } from './transactions'
import { budgetStatus } from './budgets'
import { totalsFor } from './reports'
import { listRecurring } from './recurring'
import { listLoans } from './loans'

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + n))
}
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`

/** Everything an agent needs for a morning summary, in one call. */
export async function dailyBrief(ctx: Ctx) {
  const today = todayIn(ctx.timezone)
  const yesterday = addDays(today, -1)
  const { from, toExclusive } = monthBounds(ctx.timezone)

  const yEntries = await listTransactions(ctx, transactionFilters.parse({ from: yesterday, to: yesterday, type: 'expense' }))
  const yesterdaySpent = yEntries.reduce((s, t) => s + Number(t.amount), 0)

  const month = await totalsFor(ctx.householdId, from, toExclusive)
  const budgets = await budgetStatus(ctx)

  type Warning = { category: string; status: 'over' | 'ahead_of_pace'; spent: number; budget: number }
  const warnings = budgets.budgets.flatMap((b): Warning[] => {
    if (b.budget <= 0) return []
    const pct = (b.spent / b.budget) * 100
    const cat = (b as unknown as { category: string }).category
    if (b.spent >= b.budget) return [{ category: cat, status: 'over', spent: b.spent, budget: b.budget }]
    if (budgets.month_elapsed_pct != null && pct > budgets.month_elapsed_pct + 10)
      return [{ category: cat, status: 'ahead_of_pace', spent: b.spent, budget: b.budget }]
    return []
  })

  // recurring rules due within 7 days (this month if still pending, else next month)
  const [ty, tm, td] = today.split('-').map(Number)
  const monthStart = today.slice(0, 7) + '-01'
  const upcoming = (await listRecurring(ctx))
    .filter((r) => r.active)
    .map((r) => {
      const daysThisMonth = new Date(ty, tm, 0).getDate()
      const dueDayThisMonth = Math.min(r.dayOfMonth, daysThisMonth)
      const pendingThisMonth = dueDayThisMonth >= td && !(r.lastMaterialized && r.lastMaterialized >= monthStart)
      const dueOn = pendingThisMonth
        ? `${today.slice(0, 7)}-${String(dueDayThisMonth).padStart(2, '0')}`
        : ymd(new Date(ty, tm, Math.min(r.dayOfMonth, new Date(ty, tm + 1, 0).getDate())))
      return { description: r.description, amount: Number(r.amount), due_on: dueOn }
    })
    .filter((b) => b.due_on <= addDays(today, 7))
    .sort((a, b) => a.due_on.localeCompare(b.due_on))

  const openLoans = await listLoans(ctx, 'open')
  const theyOweUs = openLoans.filter((l) => l.direction === 'lent').reduce((s, l) => s + l.outstanding, 0)
  const weOwe = openLoans.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.outstanding, 0)

  const [zs] = await db.select().from(zakatSettings).where(eq(zakatSettings.householdId, ctx.householdId))
  const zakatReminder = zs?.nextDueDate && zs.nextDueDate <= addDays(today, 30) ? zs.nextDueDate : null

  const lines = [
    `Hisaab for ${today}`,
    yesterdaySpent > 0
      ? `Yesterday: ${rs(yesterdaySpent)} spent (${yEntries.slice(0, 4).map((t) => `${t.category ?? 'Other'} ${rs(Number(t.amount))}`).join(', ')}${yEntries.length > 4 ? ', …' : ''})`
      : 'Yesterday: no spending recorded',
    `Month so far: in ${rs(month.income)} · out ${rs(month.expense)} · net ${rs(month.net)}`,
    budgets.totals.budget > 0
      ? `Budget: ${rs(budgets.totals.spent)} of ${rs(budgets.totals.budget)} used` +
        (budgets.month_elapsed_pct != null ? `, ${budgets.month_elapsed_pct}% of month gone` : '') +
        (warnings.length ? ` — watch: ${warnings.map((w) => `${w.category} (${w.status === 'over' ? 'over' : 'fast'})`).join(', ')}` : ' — on pace')
      : null,
    upcoming.length ? `Due soon: ${upcoming.map((b) => `${b.description} ${rs(b.amount)} on ${b.due_on}`).join('; ')}` : null,
    theyOweUs > 0 || weOwe > 0
      ? `Qarz: ${[theyOweUs > 0 ? `owed to us ${rs(theyOweUs)}` : null, weOwe > 0 ? `we owe ${rs(weOwe)}` : null].filter(Boolean).join(' · ')}`
      : null,
    zakatReminder ? `Zakat due date approaching: ${zakatReminder}` : null,
  ].filter(Boolean)

  return {
    date: today,
    yesterday: { total_spent: yesterdaySpent, entries: yEntries.map((t) => ({ amount: Number(t.amount), category: t.category, note: t.note, paid_by: t.paidBy })) },
    month_so_far: month,
    budgets: { totals: budgets.totals, unbudgeted_spent: budgets.unbudgeted_spent, month_elapsed_pct: budgets.month_elapsed_pct, warnings },
    upcoming_bills: upcoming,
    loans: { they_owe_us: theyOweUs, we_owe: weOwe },
    zakat_reminder: zakatReminder,
    text: lines.join('\n'),
  }
}
