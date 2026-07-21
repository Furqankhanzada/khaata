import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { budgets, categories } from '../db/schema'
import { monthBounds, todayIn } from '../util'
import type { Ctx } from '../middleware'

export const budgetInput = z.object({
  monthly_amount: z.coerce.number().min(0).describe('Monthly cap in PKR; 0 removes the budget'),
})

export async function setBudget(ctx: Ctx, categoryId: string, monthlyAmount: number) {
  if (monthlyAmount === 0) {
    await db.delete(budgets).where(and(eq(budgets.householdId, ctx.householdId), eq(budgets.categoryId, categoryId)))
    return { categoryId, monthlyAmount: 0, removed: true }
  }
  const [row] = await db.insert(budgets)
    .values({ householdId: ctx.householdId, categoryId, monthlyAmount: monthlyAmount.toFixed(2) })
    .onConflictDoUpdate({
      target: [budgets.householdId, budgets.categoryId],
      set: { monthlyAmount: monthlyAmount.toFixed(2) },
    }).returning()
  return row
}

export async function listBudgets(ctx: Ctx) {
  return db.select({ categoryId: budgets.categoryId, category: categories.name, monthlyAmount: budgets.monthlyAmount })
    .from(budgets).innerJoin(categories, eq(budgets.categoryId, categories.id))
    .where(eq(budgets.householdId, ctx.householdId))
    .orderBy(categories.name)
}

export async function budgetStatus(ctx: Ctx, month?: string) {
  const { month: m, from, toExclusive } = monthBounds(ctx.timezone, month)
  const { rows } = await db.execute<{ budget: number; spent: number }>(sql`
    select c.id as category_id, c.name as category,
           b.monthly_amount::float8 as budget,
           coalesce(s.spent, 0)::float8 as spent,
           (b.monthly_amount - coalesce(s.spent, 0))::float8 as remaining
    from budgets b
    join categories c on c.id = b.category_id
    left join (
      select category_id, sum(amount) as spent
      from transactions
      where household_id = ${ctx.householdId} and type = 'expense'
        and occurred_on >= ${from} and occurred_on < ${toExclusive}
      group by category_id
    ) s on s.category_id = b.category_id
    where b.household_id = ${ctx.householdId}
    order by c.name`)

  const totalExpense = await db.execute<{ total: number }>(sql`
    select coalesce(sum(amount), 0)::float8 as total from transactions
    where household_id = ${ctx.householdId} and type = 'expense'
      and occurred_on >= ${from} and occurred_on < ${toExclusive}`)

  const budget = rows.reduce((s, r) => s + r.budget, 0)
  const spent = rows.reduce((s, r) => s + r.spent, 0)

  // pace: how far through this month are we (only meaningful for the current month)
  const today = todayIn(ctx.timezone)
  let monthElapsedPct: number | null = null
  if (today.slice(0, 7) === m) {
    const [y, mo, d] = today.split('-').map(Number)
    monthElapsedPct = Math.round((d / new Date(y, mo, 0).getDate()) * 100)
  }

  return {
    month: m,
    budgets: rows,
    totals: { budget, spent, remaining: budget - spent },
    unbudgeted_spent: Math.round((Number(totalExpense.rows[0].total) - spent) * 100) / 100,
    month_elapsed_pct: monthElapsedPct,
  }
}
