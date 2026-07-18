import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { recurringRules, transactions } from '../db/schema'
import { todayPk } from '../util'
import type { Ctx } from '../middleware'
import { addCategory } from './transactions'

export const recurringInput = z.object({
  type: z.enum(['expense', 'income']),
  amount: z.coerce.number().positive().describe('Amount in PKR'),
  category: z.string().optional().describe('Category name'),
  description: z.string().min(1).describe('e.g. "House rent", "School fees"'),
  day_of_month: z.coerce.number().int().min(1).max(31).describe('Day it falls due (clamped to month length)'),
})

export const recurringUpdate = recurringInput.partial().extend({ active: z.boolean().optional() })

export async function addRecurring(ctx: Ctx, input: z.infer<typeof recurringInput>) {
  const categoryId = input.category ? (await addCategory(ctx, { name: input.category, kind: input.type })).id : null
  const [row] = await db.insert(recurringRules).values({
    householdId: ctx.householdId,
    userId: ctx.userId,
    type: input.type,
    amount: input.amount.toFixed(2),
    categoryId,
    description: input.description,
    dayOfMonth: input.day_of_month,
  }).returning()
  return row
}

export async function listRecurring(ctx: Ctx) {
  return db.select().from(recurringRules)
    .where(eq(recurringRules.householdId, ctx.householdId))
    .orderBy(recurringRules.dayOfMonth)
}

export async function updateRecurring(ctx: Ctx, id: string, input: z.infer<typeof recurringUpdate>) {
  const [existing] = await db.select().from(recurringRules)
    .where(and(eq(recurringRules.id, id), eq(recurringRules.householdId, ctx.householdId)))
  if (!existing) return null
  const type = input.type ?? existing.type
  const categoryId = input.category ? (await addCategory(ctx, { name: input.category, kind: type })).id : existing.categoryId
  const [row] = await db.update(recurringRules).set({
    type,
    amount: input.amount !== undefined ? input.amount.toFixed(2) : undefined,
    categoryId,
    description: input.description,
    dayOfMonth: input.day_of_month,
    active: input.active,
  }).where(eq(recurringRules.id, id)).returning()
  return row
}

export async function deleteRecurring(ctx: Ctx, id: string) {
  const rows = await db.update(recurringRules).set({ active: false })
    .where(and(eq(recurringRules.id, id), eq(recurringRules.householdId, ctx.householdId)))
    .returning({ id: recurringRules.id })
  return rows.length > 0
}

/** Insert due transactions for all active rules. Idempotent; catches up after downtime. */
export async function materializeDueRules() {
  const today = todayPk()
  const [y, m, d] = today.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const monthStart = today.slice(0, 7) + '-01'

  const rules = await db.select().from(recurringRules).where(eq(recurringRules.active, true))
  let created = 0
  for (const rule of rules) {
    const dueDay = Math.min(rule.dayOfMonth, daysInMonth)
    const dueDate = `${today.slice(0, 7)}-${String(dueDay).padStart(2, '0')}`
    const alreadyDone = rule.lastMaterialized && rule.lastMaterialized >= monthStart
    if (d >= dueDay && !alreadyDone) {
      await db.insert(transactions).values({
        householdId: rule.householdId,
        userId: rule.userId,
        type: rule.type,
        amount: rule.amount,
        categoryId: rule.categoryId,
        note: rule.description,
        occurredOn: dueDate,
        source: 'recurring',
        recurringRuleId: rule.id,
      })
      await db.update(recurringRules).set({ lastMaterialized: today }).where(eq(recurringRules.id, rule.id))
      created++
    }
  }
  if (created) console.log(`[recurring] materialized ${created} transaction(s)`)
  return created
}
