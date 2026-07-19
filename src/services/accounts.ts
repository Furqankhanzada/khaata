import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { accounts } from '../db/schema'
import type { Ctx } from '../middleware'
import { BASE, currencyCode, latestRate } from './fx'

export const visibilityInput = z.enum(['shared', 'private'])
  .default('private')
  .describe("'private' = only you see it; 'shared' = visible to the whole household")

export const accountInput = z.object({
  name: z.string().min(1).describe("e.g. 'Meezan current account', 'Payoneer', 'Upwork'"),
  balance: z.coerce.number().min(0).default(0).describe("Current balance in the account's own currency"),
  currency: currencyCode.default(BASE).describe("Account currency, e.g. 'USD' for Payoneer/Upwork"),
  zakatable: z.boolean().default(true),
  visibility: visibilityInput,
})

export const accountUpdate = accountInput.partial()

/** shared items, your own items, and legacy unowned rows */
const visibleTo = (userId: string) =>
  or(eq(accounts.visibility, 'shared'), eq(accounts.userId, userId), isNull(accounts.userId))

export async function listAccounts(ctx: Ctx) {
  // native balance + PKR value at the latest stored rate (rate/base_balance null if no rate yet)
  const { rows } = await db.execute(sql`
    select a.*, a.balance::float8 as balance,
           (case when a.currency = ${BASE} then 1 else fx.rate end)::float8 as rate,
           fx.as_of::text as rate_as_of,
           round(a.balance * (case when a.currency = ${BASE} then 1 else fx.rate end), 2)::float8 as base_balance
    from accounts a
    left join lateral (
      select rate, as_of from fx_rates where base = ${BASE} and quote = a.currency
      order by as_of desc limit 1
    ) fx on a.currency != ${BASE}
    where a.household_id = ${ctx.householdId}
      and (a.visibility = 'shared' or a.user_id = ${ctx.userId} or a.user_id is null)
    order by a.name`)
  return rows
}

export async function addAccount(ctx: Ctx, input: z.infer<typeof accountInput>) {
  if (input.currency !== BASE) await latestRate(input.currency) // ensure a rate exists up front
  const [row] = await db.insert(accounts).values({
    householdId: ctx.householdId,
    userId: ctx.userId,
    name: input.name,
    balance: input.balance.toFixed(2),
    currency: input.currency,
    zakatable: input.zakatable,
    visibility: input.visibility,
  }).returning()
  return row
}

export async function updateAccount(ctx: Ctx, id: string, input: z.infer<typeof accountUpdate>) {
  if (input.currency && input.currency !== BASE) await latestRate(input.currency)
  const [row] = await db.update(accounts).set({
    name: input.name,
    balance: input.balance !== undefined ? input.balance.toFixed(2) : undefined,
    currency: input.currency,
    zakatable: input.zakatable,
    visibility: input.visibility,
    updatedAt: new Date(),
  }).where(and(eq(accounts.id, id), eq(accounts.householdId, ctx.householdId), visibleTo(ctx.userId))).returning()
  return row ?? null
}

export async function deleteAccount(ctx: Ctx, id: string) {
  const rows = await db.delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, ctx.householdId), visibleTo(ctx.userId)))
    .returning({ id: accounts.id })
  return rows.length > 0
}
