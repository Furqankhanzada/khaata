import { and, desc, eq, lt, or, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { auditLog, user } from '../db/schema'
import type { Ctx } from '../middleware'
import { notify } from './events'

type AuditEntry = {
  channel: 'api' | 'mcp'
  action: string
  detail?: unknown
  userId: string
  householdId: string | null
}

/** Record a successful mutation. Never throws — audit must not fail the user's write. */
export async function audit(entry: AuditEntry) {
  try {
    await db.insert(auditLog).values(entry)
  } catch (e) {
    console.error('[audit]', e)
  }
  notify(entry.householdId) // audit sees every mutation — the natural place to push live-sync nudges
}

export async function purgeAuditLog() {
  await db.delete(auditLog).where(lt(auditLog.at, sql`now() - interval '30 days'`))
}

// shared-domain actions (matched anywhere in the action string) are visible household-wide;
// everything else — wealth: holdings, loans, accounts, zakat, prices — only to its actor
const SHARED_ACTIONS = 'transaction|categor|budget|recurring|household'

export async function listAudit(ctx: Ctx, limit = 50) {
  return db.select({
    at: auditLog.at,
    userId: auditLog.userId,
    actor: user.name,
    channel: auditLog.channel,
    action: auditLog.action,
    detail: auditLog.detail,
  }).from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .where(and(
      eq(auditLog.householdId, ctx.householdId),
      or(eq(auditLog.userId, ctx.userId), sql`${auditLog.action} ~ ${SHARED_ACTIONS}`),
    ))
    .orderBy(desc(auditLog.at))
    .limit(limit)
}
