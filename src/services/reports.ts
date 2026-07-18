import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { monthBounds } from '../util'
import { budgetStatus } from './budgets'
import type { Ctx } from '../middleware'

export async function monthlyReport(ctx: Ctx, month?: string) {
  const { month: m, from, toExclusive } = monthBounds(month)
  const range = sql`household_id = ${ctx.householdId} and occurred_on >= ${from} and occurred_on < ${toExclusive}`

  const totals = await db.execute(sql`
    select type, sum(amount)::float8 as total, count(*)::int as count
    from transactions where ${range} group by type`)
  const byCategory = await db.execute(sql`
    select t.type, coalesce(c.name, 'Uncategorized') as category, sum(t.amount)::float8 as total
    from transactions t left join categories c on c.id = t.category_id
    where t.household_id = ${ctx.householdId} and t.occurred_on >= ${from} and t.occurred_on < ${toExclusive}
    group by t.type, c.name order by total desc`)
  const byMember = await db.execute(sql`
    select u.name as member, t.type, sum(t.amount)::float8 as total
    from transactions t join "user" u on u.id = t.user_id
    where t.household_id = ${ctx.householdId} and t.occurred_on >= ${from} and t.occurred_on < ${toExclusive}
    group by u.name, t.type order by u.name`)

  const income = Number(totals.rows.find(r => r.type === 'income')?.total ?? 0)
  const expense = Number(totals.rows.find(r => r.type === 'expense')?.total ?? 0)
  return {
    month: m,
    income,
    expense,
    net: income - expense,
    by_category: byCategory.rows,
    by_member: byMember.rows,
    budgets: (await budgetStatus(ctx, m)).budgets,
  }
}
