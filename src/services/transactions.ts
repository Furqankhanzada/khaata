import { and, desc, eq, gte, ilike, lte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { categories, transactions, user } from '../db/schema'
import { todayPk } from '../util'
import type { Ctx } from '../middleware'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const transactionInput = z.object({
  type: z.enum(['expense', 'income']).describe("'expense' or 'income'"),
  amount: z.coerce.number().positive().describe('Amount in PKR'),
  category_id: z.string().optional(),
  category: z.string().optional().describe("Category name, e.g. 'Groceries' (created if new)"),
  note: z.string().optional().describe('Free-text note, e.g. what was bought'),
  occurred_on: dateStr.optional().describe('Date YYYY-MM-DD, defaults to today (Pakistan time)'),
})

export const transactionFilters = z.object({
  from: dateStr.optional().describe('Start date inclusive'),
  to: dateStr.optional().describe('End date inclusive'),
  type: z.enum(['expense', 'income']).optional(),
  category_id: z.string().optional(),
  user_id: z.string().optional().describe('Filter by which household member paid'),
  q: z.string().optional().describe('Search in notes'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const transactionUpdate = transactionInput.partial()

async function resolveCategoryId(ctx: Ctx, kind: 'expense' | 'income', categoryId?: string, categoryName?: string) {
  if (categoryId) return categoryId
  if (!categoryName) return null
  const [found] = await db.select({ id: categories.id }).from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), ilike(categories.name, categoryName), eq(categories.kind, kind)))
  if (found) return found.id
  const [created] = await db.insert(categories)
    .values({ householdId: ctx.householdId, name: categoryName, kind }).returning({ id: categories.id })
  return created.id
}

const selection = {
  id: transactions.id,
  type: transactions.type,
  amount: transactions.amount,
  categoryId: transactions.categoryId,
  category: categories.name,
  note: transactions.note,
  occurredOn: transactions.occurredOn,
  source: transactions.source,
  userId: transactions.userId,
  paidBy: user.name,
}

export async function getTransaction(ctx: Ctx, id: string) {
  const [row] = await db.select(selection).from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(user, eq(transactions.userId, user.id))
    .where(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
  return row ?? null
}

export async function addTransaction(ctx: Ctx, input: z.infer<typeof transactionInput>) {
  const categoryId = await resolveCategoryId(ctx, input.type, input.category_id, input.category)
  const [row] = await db.insert(transactions).values({
    householdId: ctx.householdId,
    userId: ctx.userId,
    type: input.type,
    amount: input.amount.toFixed(2),
    categoryId,
    note: input.note,
    occurredOn: input.occurred_on ?? todayPk(),
  }).returning({ id: transactions.id })
  return getTransaction(ctx, row.id)
}

export async function listTransactions(ctx: Ctx, f: z.infer<typeof transactionFilters>) {
  const conds = [eq(transactions.householdId, ctx.householdId)]
  if (f.from) conds.push(gte(transactions.occurredOn, f.from))
  if (f.to) conds.push(lte(transactions.occurredOn, f.to))
  if (f.type) conds.push(eq(transactions.type, f.type))
  if (f.category_id) conds.push(eq(transactions.categoryId, f.category_id))
  if (f.user_id) conds.push(eq(transactions.userId, f.user_id))
  if (f.q) conds.push(ilike(transactions.note, `%${f.q}%`))
  return db.select(selection).from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(user, eq(transactions.userId, user.id))
    .where(and(...conds))
    .orderBy(desc(transactions.occurredOn), desc(transactions.createdAt))
    .limit(f.limit).offset(f.offset)
}

export async function updateTransaction(ctx: Ctx, id: string, input: z.infer<typeof transactionUpdate>) {
  const existing = await getTransaction(ctx, id)
  if (!existing) return null
  const type = input.type ?? existing.type
  const categoryId = (input.category_id || input.category)
    ? await resolveCategoryId(ctx, type, input.category_id, input.category)
    : existing.categoryId
  await db.update(transactions).set({
    type,
    amount: input.amount !== undefined ? input.amount.toFixed(2) : undefined,
    categoryId,
    note: input.note ?? undefined,
    occurredOn: input.occurred_on ?? undefined,
  }).where(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
  return getTransaction(ctx, id)
}

export async function deleteTransaction(ctx: Ctx, id: string) {
  const rows = await db.delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.householdId, ctx.householdId)))
    .returning({ id: transactions.id })
  return rows.length > 0
}

export async function listCategories(ctx: Ctx) {
  return db.select().from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), eq(categories.archived, false)))
    .orderBy(categories.kind, categories.name)
}

export const categoryInput = z.object({
  name: z.string().min(1),
  kind: z.enum(['expense', 'income']),
})

export async function addCategory(ctx: Ctx, input: z.infer<typeof categoryInput>) {
  const [row] = await db.insert(categories)
    .values({ householdId: ctx.householdId, ...input })
    .onConflictDoNothing().returning()
  return row ?? db.select().from(categories)
    .where(and(eq(categories.householdId, ctx.householdId), eq(categories.name, input.name), eq(categories.kind, input.kind)))
    .then(r => r[0])
}
