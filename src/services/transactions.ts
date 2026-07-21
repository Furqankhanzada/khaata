import { and, arrayContains, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db/client'
import { categories, tags, transactions, user } from '../db/schema'
import { todayIn } from '../util'
import type { Ctx } from '../middleware'
import { currencyCode, latestRate } from './fx'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const transactionInput = z.object({
  id: z.string().uuid().optional().describe('Client-generated id — makes offline-sync replays idempotent'),
  type: z.enum(['expense', 'income']).describe("'expense' or 'income'"),
  amount: z.coerce.number().positive().describe('Amount (PKR unless currency is given)'),
  currency: currencyCode.optional().describe("Currency of amount if not PKR, e.g. 'USD' for $20 spent abroad"),
  fx_rate: z.coerce.number().positive().optional().describe('PKR per 1 unit of currency; defaults to the latest daily rate'),
  category_id: z.string().optional(),
  category: z.string().optional().describe("Category name, e.g. 'Groceries' (created if new)"),
  tags: z.array(z.string()).optional()
    .describe("What was bought, from the household's tag vocabulary — broad + specific together, e.g. ['meat','chicken']. Call list_tags first; unknown tags are rejected."),
  note: z.string().optional().describe('Free-text note, e.g. what was bought'),
  occurred_on: dateStr.optional().describe('Date YYYY-MM-DD, defaults to today (Pakistan time)'),
})

/** Foreign entries convert once at entry: amount column is always the household base, original preserved. */
async function resolveMoney(base: string, input: { amount: number; currency?: string; fx_rate?: number }) {
  if (!input.currency || input.currency === base) {
    return { amount: input.amount.toFixed(2), originalAmount: null, originalCurrency: null, fxRate: null }
  }
  const rate = input.fx_rate ?? (await latestRate(base, input.currency))
  return {
    amount: (input.amount * rate).toFixed(2),
    originalAmount: input.amount.toFixed(2),
    originalCurrency: input.currency,
    fxRate: rate.toFixed(8),
  }
}

export const transactionFilters = z.object({
  from: dateStr.optional().describe('Start date inclusive'),
  to: dateStr.optional().describe('End date inclusive'),
  type: z.enum(['expense', 'income']).optional(),
  category_id: z.string().optional(),
  tags: z.array(z.string()).optional()
    .describe("Only entries carrying all of these tags, e.g. ['meat'] — exact, unlike a q search"),
  user_id: z.string().optional().describe('Filter by which household member paid'),
  q: z.string().optional().describe('Search notes, tags and payer names'),
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

/**
 * Tags are a controlled vocabulary: unknown names are rejected rather than created (categories do
 * the opposite). That strictness is the feature — it's what stops "meats"/"beef" drifting apart and
 * keeps "how much on meat" exact. The error lists the valid tags so a caller can correct itself.
 */
async function resolveTags(ctx: Ctx, names: string[]) {
  if (!names.length) return []
  const known = await db.select({ name: tags.name }).from(tags).where(eq(tags.householdId, ctx.householdId))
  const canonical = new Map(known.map((t) => [t.name.toLowerCase(), t.name]))
  const unknown = names.filter((n) => !canonical.has(n.trim().toLowerCase()))
  if (unknown.length)
    throw new HTTPException(400, {
      message: `unknown tag(s): ${unknown.join(', ')} — valid: ${known.map((t) => t.name).sort().join(', ') || '(none yet)'} (add one with add_tag)`,
    })
  return [...new Set(names.map((n) => canonical.get(n.trim().toLowerCase())!))]
}

const selection = {
  id: transactions.id,
  type: transactions.type,
  amount: transactions.amount,
  originalAmount: transactions.originalAmount,
  originalCurrency: transactions.originalCurrency,
  fxRate: transactions.fxRate,
  categoryId: transactions.categoryId,
  category: categories.name,
  tags: transactions.tags,
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
  const money = await resolveMoney(ctx.baseCurrency, input)
  const [row] = await db.insert(transactions).values({
    id: input.id,
    householdId: ctx.householdId,
    userId: ctx.userId,
    type: input.type,
    ...money,
    categoryId,
    tags: await resolveTags(ctx, input.tags ?? []),
    note: input.note,
    occurredOn: input.occurred_on ?? todayIn(ctx.timezone),
  }).onConflictDoNothing().returning({ id: transactions.id })
  // no row = the client id already exists (offline replay) — return the existing one
  return getTransaction(ctx, row?.id ?? input.id!)
}

export async function listTransactions(ctx: Ctx, f: z.infer<typeof transactionFilters>) {
  const conds = [eq(transactions.householdId, ctx.householdId)]
  if (f.from) conds.push(gte(transactions.occurredOn, f.from))
  if (f.to) conds.push(lte(transactions.occurredOn, f.to))
  if (f.type) conds.push(eq(transactions.type, f.type))
  if (f.category_id) conds.push(eq(transactions.categoryId, f.category_id))
  if (f.tags?.length) conds.push(arrayContains(transactions.tags, f.tags)) // all of them, not any
  if (f.user_id) conds.push(eq(transactions.userId, f.user_id))
  if (f.q) conds.push(or(
    ilike(transactions.note, `%${f.q}%`),
    ilike(user.name, `%${f.q}%`),
    sql`array_to_string(${transactions.tags}, ' ') ilike ${'%' + f.q + '%'}`,
  )!)
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
  // re-passing an amount redefines the money (foreign if currency given, else plain PKR)
  const money = input.amount !== undefined ? await resolveMoney(ctx.baseCurrency, { amount: input.amount, currency: input.currency, fx_rate: input.fx_rate }) : {}
  await db.update(transactions).set({
    type,
    ...money,
    categoryId,
    // omitted tags are left alone; [] clears them
    tags: input.tags ? await resolveTags(ctx, input.tags) : undefined,
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

export async function listTags(ctx: Ctx) {
  return db.select().from(tags)
    .where(and(eq(tags.householdId, ctx.householdId), eq(tags.archived, false)))
    .orderBy(tags.name)
}

export const tagInput = z.object({
  id: z.string().uuid().optional().describe('Client-generated id — makes offline-sync replays idempotent'),
  name: z.string().min(1).describe("What was bought, e.g. 'meat' or 'chicken'"),
})

export async function addTag(ctx: Ctx, input: z.infer<typeof tagInput>) {
  const name = input.name.trim()
  // case-insensitive: 'Meat' must not become a second tag next to 'meat'
  const [existing] = await db.select().from(tags)
    .where(and(eq(tags.householdId, ctx.householdId), ilike(tags.name, name)))
  if (existing) return existing
  const [row] = await db.insert(tags)
    .values({ id: input.id, householdId: ctx.householdId, name })
    .onConflictDoNothing().returning()
  return row ?? db.select().from(tags)
    .where(and(eq(tags.householdId, ctx.householdId), eq(tags.name, name))).then((r) => r[0])
}
