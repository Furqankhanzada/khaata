import { createMiddleware } from 'hono/factory'
import { eq } from 'drizzle-orm'
import { auth } from './auth'
import { db } from './db/client'
import { user } from './db/schema'

export type Ctx = { userId: string; householdId: string }
export type AuthEnv = { Variables: { userId: string; householdId: string | null } }

export function apiKeyFrom(headers: { [k: string]: string | undefined }): string | undefined {
  return headers['x-api-key'] ?? headers['authorization']?.replace(/^Bearer\s+/i, '')
}

export async function ctxFromApiKey(key: string): Promise<{ userId: string; householdId: string | null } | null> {
  const res = await auth.api.verifyApiKey({ body: { key } })
  if (!res.valid || !res.key) return null
  const userId = (res.key as { userId?: string; referenceId?: string }).userId ?? (res.key as { referenceId?: string }).referenceId
  if (!userId) return null
  const [u] = await db.select({ householdId: user.householdId }).from(user).where(eq(user.id, userId))
  if (!u) return null
  return { userId, householdId: u.householdId }
}

/** Session cookie (web) or API key (agents) → userId + householdId on context. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const key = apiKeyFrom({ 'x-api-key': c.req.header('x-api-key'), authorization: c.req.header('authorization') })
  if (key) {
    const ctx = await ctxFromApiKey(key)
    if (!ctx) return c.json({ error: 'invalid API key' }, 401)
    c.set('userId', ctx.userId)
    c.set('householdId', ctx.householdId)
    return next()
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) return c.json({ error: 'unauthorized' }, 401)
  c.set('userId', session.user.id)
  c.set('householdId', (session.user as { householdId?: string | null }).householdId ?? null)
  return next()
})

export const requireHousehold = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.get('householdId')) {
    return c.json({ error: 'no household yet — POST /api/v1/household {name} to create one, or {invite_code} to join' }, 403)
  }
  return next()
})

export function hctx(c: { get: (k: 'userId' | 'householdId') => string | null }): Ctx {
  return { userId: c.get('userId')!, householdId: c.get('householdId')! }
}
