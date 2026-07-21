import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { categories, households, user } from '../db/schema'
import { newInviteCode } from '../util'
import type { Ctx } from '../middleware'

const DEFAULT_CATEGORIES: [string, 'expense' | 'income'][] = [
  ['Groceries', 'expense'], ['Food & Dining', 'expense'], ['Transport', 'expense'],
  ['Fuel', 'expense'], ['Utilities', 'expense'], ['Phone/Internet', 'expense'],
  ['Rent', 'expense'], ['Bills/Taxes', 'expense'], ['Health', 'expense'],
  ['Education', 'expense'], ['Shopping', 'expense'], ['Charity', 'expense'],
  ['Personal', 'expense'], ['Other', 'expense'],
  ['Salary', 'income'], ['Business', 'income'], ['Investment', 'income'], ['Other', 'income'],
]

export async function createHousehold(userId: string, name: string, timezone: string, baseCurrency: string) {
  const [h] = await db.insert(households).values({ name, inviteCode: newInviteCode(), timezone, baseCurrency }).returning()
  await db.insert(categories).values(DEFAULT_CATEGORIES.map(([n, kind]) => ({ householdId: h.id, name: n, kind })))
  await db.update(user).set({ householdId: h.id }).where(eq(user.id, userId))
  return h
}

export async function joinHousehold(userId: string, inviteCode: string) {
  const [h] = await db.select().from(households).where(eq(households.inviteCode, inviteCode))
  if (!h) return null
  await db.update(user).set({ householdId: h.id }).where(eq(user.id, userId))
  return h
}

export async function getHousehold(ctx: Ctx) {
  const [h] = await db.select().from(households).where(eq(households.id, ctx.householdId))
  if (!h) return null
  const members = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user).where(eq(user.householdId, ctx.householdId))
  return { ...h, members }
}

export async function updateHousehold(ctx: Ctx, patch: { name?: string; timezone?: string }) {
  const [h] = await db.update(households).set(patch).where(eq(households.id, ctx.householdId)).returning()
  return h
}

export async function rotateInvite(ctx: Ctx) {
  const [h] = await db.update(households)
    .set({ inviteCode: newInviteCode() })
    .where(eq(households.id, ctx.householdId)).returning()
  return h
}
