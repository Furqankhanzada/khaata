import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db/client'
import { households, user } from './db/schema'

export type Ctx = { userId: string; householdId: string; timezone: string }
export type AuthEnv = { Variables: { userId: string; householdId: string | null; timezone: string | null } }

export function apiKeyFrom(headers: { [k: string]: string | undefined }): string | undefined {
  return headers['x-api-key'] ?? headers['authorization']?.replace(/^Bearer\s+/i, '')
}

async function householdOf(userId: string): Promise<{ householdId: string | null; timezone: string | null }> {
  const [row] = await db
    .select({ householdId: user.householdId, timezone: households.timezone })
    .from(user)
    .leftJoin(households, eq(user.householdId, households.id))
    .where(eq(user.id, userId))
  return { householdId: row?.householdId ?? null, timezone: row?.timezone ?? null }
}

export async function ctxFromApiKey(key: string): Promise<{ userId: string; householdId: string | null; timezone: string | null } | null> {
  const res = await auth.api.verifyApiKey({ body: { key } })
  if (!res.valid || !res.key) return null
  const userId = (res.key as { userId?: string; referenceId?: string }).userId ?? (res.key as { referenceId?: string }).referenceId
  if (!userId) return null
  return { userId, ...(await householdOf(userId)) }
}

/** Session cookie (web) or API key (agents) → userId + householdId + household timezone on context. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const key = apiKeyFrom({ 'x-api-key': c.req.header('x-api-key'), authorization: c.req.header('authorization') })
  if (key) {
    const ctx = await ctxFromApiKey(key)
    if (!ctx) return c.json({ error: 'invalid API key' }, 401)
    c.set('userId', ctx.userId)
    c.set('householdId', ctx.householdId)
    c.set('timezone', ctx.timezone)
    return next()
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  const hh = await householdOf(session.user.id)
  c.set('userId', session.user.id)
  c.set('householdId', hh.householdId)
  c.set('timezone', hh.timezone)
  return next()
})

export const requireHousehold = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.get('householdId')) {
    return c.json({ error: 'no household yet — POST /api/v1/household {name} to create one, or {invite_code} to join' }, 403)
  }
  return next()
})

export function hctx(c: { get: (k: 'userId' | 'householdId' | 'timezone') => string | null }): Ctx {
  return { userId: c.get('userId')!, householdId: c.get('householdId')!, timezone: c.get('timezone')! }
}
