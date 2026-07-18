import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { accounts } from '../db/schema'
import type { Ctx } from '../middleware'

export const accountInput = z.object({
  name: z.string().min(1).describe("e.g. 'Meezan current account', 'Cash wallet'"),
  balance: z.coerce.number().min(0).default(0).describe('Current balance in PKR'),
  zakatable: z.boolean().default(true),
})

export const accountUpdate = accountInput.partial()

export async function listAccounts(ctx: Ctx) {
  return db.select().from(accounts).where(eq(accounts.householdId, ctx.householdId)).orderBy(accounts.name)
}

export async function addAccount(ctx: Ctx, input: z.infer<typeof accountInput>) {
  const [row] = await db.insert(accounts).values({
    householdId: ctx.householdId,
    name: input.name,
    balance: input.balance.toFixed(2),
    zakatable: input.zakatable,
  }).returning()
  return row
}

export async function updateAccount(ctx: Ctx, id: string, input: z.infer<typeof accountUpdate>) {
  const [row] = await db.update(accounts).set({
    name: input.name,
    balance: input.balance !== undefined ? input.balance.toFixed(2) : undefined,
    zakatable: input.zakatable,
    updatedAt: new Date(),
  }).where(and(eq(accounts.id, id), eq(accounts.householdId, ctx.householdId))).returning()
  return row ?? null
}

export async function deleteAccount(ctx: Ctx, id: string) {
  const rows = await db.delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.householdId, ctx.householdId)))
    .returning({ id: accounts.id })
  return rows.length > 0
}
