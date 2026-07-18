import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { zakatSettings } from '../db/schema'
import type { Ctx } from '../middleware'

export const zakatSettingsInput = z.object({
  nisab_amount: z.coerce.number().positive().describe('Current nisab threshold in PKR (check the gold/silver rate yearly)'),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Your zakat anniversary (Gregorian date)'),
})

export async function setZakatSettings(ctx: Ctx, input: z.infer<typeof zakatSettingsInput>) {
  const [row] = await db.insert(zakatSettings).values({
    householdId: ctx.householdId,
    nisabAmount: input.nisab_amount.toFixed(2),
    nextDueDate: input.next_due_date,
  }).onConflictDoUpdate({
    target: zakatSettings.householdId,
    set: { nisabAmount: input.nisab_amount.toFixed(2), nextDueDate: input.next_due_date, updatedAt: new Date() },
  }).returning()
  return row
}

export async function zakatSummary(ctx: Ctx) {
  const accounts = await db.execute(sql`
    select name, balance::float8 as value from accounts
    where household_id = ${ctx.householdId} and zakatable = true`)
  const investments = await db.execute(sql`
    select i.name, (h.units * p.price)::float8 as value, p.as_of::text as price_as_of
    from holdings h
    join instruments i on i.id = h.instrument_id
    left join lateral (
      select price, as_of from prices where instrument_id = i.id order by as_of desc limit 1
    ) p on true
    where h.household_id = ${ctx.householdId} and h.zakatable = true`)
  const debts = await db.execute(sql`
    select l.counterparty, (l.principal - coalesce(p.paid, 0))::float8 as value
    from loans l
    left join (select loan_id, sum(amount) as paid from loan_payments group by loan_id) p on p.loan_id = l.id
    where l.household_id = ${ctx.householdId} and l.direction = 'borrowed' and l.status = 'open'`)

  const assetTotal =
    accounts.rows.reduce((s, r) => s + Number(r.value ?? 0), 0) +
    investments.rows.reduce((s, r) => s + Number(r.value ?? 0), 0)
  const debtTotal = debts.rows.reduce((s, r) => s + Number(r.value ?? 0), 0)
  const base = assetTotal - debtTotal

  const [settings] = await db.select().from(zakatSettings).where(sql`household_id = ${ctx.householdId}`)
  const nisab = settings ? Number(settings.nisabAmount) : null

  return {
    zakatable_assets: { accounts: accounts.rows, investments: investments.rows },
    deductible_debts: debts.rows,
    zakatable_base: base,
    nisab_amount: nisab,
    above_nisab: nisab !== null ? base >= nisab : null,
    zakat_due: nisab !== null && base >= nisab ? Math.round(base * 0.025 * 100) / 100 : 0,
    next_due_date: settings?.nextDueDate ?? null,
    note: nisab === null ? 'Set nisab_amount via PUT /api/v1/zakat/settings (or set_zakat_settings tool) to compute zakat.' : undefined,
  }
}
