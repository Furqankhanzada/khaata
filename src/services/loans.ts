import { and, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { loanPayments, loans } from '../db/schema'
import { todayPk } from '../util'
import type { Ctx } from '../middleware'
import { visibilityInput } from './accounts'

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const loanInput = z.object({
  id: z.string().uuid().optional().describe('Client-generated id — makes offline-sync replays idempotent'),
  counterparty: z.string().min(1).describe('Who the loan is with, e.g. "Ahmed bhai"'),
  direction: z.enum(['lent', 'borrowed']).describe("'lent' = they owe us, 'borrowed' = we owe them"),
  principal: z.coerce.number().positive().describe('Amount in PKR'),
  start_date: dateStr.optional().describe('Defaults to today'),
  visibility: visibilityInput,
  note: z.string().optional(),
})

const loanVisibleTo = (userId: string) => or(eq(loans.visibility, 'shared'), eq(loans.userId, userId))

export const loanPaymentInput = z.object({
  id: z.string().uuid().optional().describe('Client-generated id — makes offline-sync replays idempotent'),
  amount: z.coerce.number().positive().describe('Repayment amount in PKR'),
  paid_on: dateStr.optional().describe('Defaults to today'),
  note: z.string().optional(),
})

export async function addLoan(ctx: Ctx, input: z.infer<typeof loanInput>) {
  const [row] = await db.insert(loans).values({
    id: input.id,
    householdId: ctx.householdId,
    userId: ctx.userId,
    counterparty: input.counterparty,
    direction: input.direction,
    principal: input.principal.toFixed(2),
    startDate: input.start_date ?? todayPk(),
    visibility: input.visibility,
    note: input.note,
  }).onConflictDoNothing().returning()
  if (!row) return getLoan(ctx, input.id!) // offline replay of an already-applied create
  return { ...row, paid: 0, outstanding: Number(row.principal) }
}

type LoanRow = { [k: string]: unknown; id: string; outstanding: number }

export async function listLoans(ctx: Ctx, status?: 'open' | 'settled') {
  const { rows } = await db.execute<LoanRow>(sql`
    select l.*, coalesce(p.paid, 0)::float8 as paid,
           (l.principal - coalesce(p.paid, 0))::float8 as outstanding
    from loans l
    left join (select loan_id, sum(amount) as paid from loan_payments group by loan_id) p on p.loan_id = l.id
    where l.household_id = ${ctx.householdId}
      and (l.visibility = 'shared' or l.user_id = ${ctx.userId})
      ${status ? sql`and l.status = ${status}` : sql``}
    order by l.start_date desc`)
  return rows
}

export async function getLoan(ctx: Ctx, id: string) {
  const all = await listLoans(ctx)
  const loan = all.find(l => l.id === id)
  if (!loan) return null
  const payments = await db.select().from(loanPayments).where(eq(loanPayments.loanId, id)).orderBy(loanPayments.paidOn)
  return { ...loan, payments }
}

export async function updateLoan(ctx: Ctx, id: string, patch: { status?: 'open' | 'settled'; note?: string; visibility?: 'shared' | 'private' }) {
  const [row] = await db.update(loans).set(patch)
    .where(and(eq(loans.id, id), eq(loans.householdId, ctx.householdId), loanVisibleTo(ctx.userId))).returning()
  return row ?? null
}

export async function addLoanPayment(ctx: Ctx, loanId: string, input: z.infer<typeof loanPaymentInput>) {
  const [loan] = await db.select().from(loans)
    .where(and(eq(loans.id, loanId), eq(loans.householdId, ctx.householdId), loanVisibleTo(ctx.userId)))
  if (!loan) return null
  await db.insert(loanPayments).values({
    id: input.id,
    loanId,
    amount: input.amount.toFixed(2),
    paidOn: input.paid_on ?? todayPk(),
    note: input.note,
  }).onConflictDoNothing()
  const updated = await getLoan(ctx, loanId)
  if (updated && Number(updated.outstanding) <= 0 && loan.status === 'open') {
    await db.update(loans).set({ status: 'settled' }).where(eq(loans.id, loanId))
    return getLoan(ctx, loanId)
  }
  return updated
}
