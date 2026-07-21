import { eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { budgets, loanPayments, user, zakatSettings } from '../db/schema'
import type { Ctx } from '../middleware'
import * as tx from './transactions'
import * as household from './household'
import * as loans from './loans'
import * as accounts from './accounts'
import * as recurring from './recurring'
import * as portfolio from './portfolio'


/** FNV-1a — cheap stable content hash for the ETag; not cryptographic, doesn't need to be. */
function hashOf(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * The full per-user dataset for the offline-first client, one call.
 * Composes the existing service reads so wealth visibility rules apply unchanged.
 */
export async function getSnapshot(ctx: Ctx) {
  const [me, hh, categories, tagList, transactions, budgetRows, loanList, accountList, recurringList, portfolioData, zakat, fx] =
    await Promise.all([
      db.select({ id: user.id, name: user.name, email: user.email, householdId: user.householdId })
        .from(user).where(eq(user.id, ctx.userId)).then((r) => r[0]),
      household.getHousehold(ctx),
      tx.listCategories(ctx),
      tx.listTags(ctx),
      tx.listTransactions(ctx, { limit: 10000, offset: 0 }),
      db.select().from(budgets).where(eq(budgets.householdId, ctx.householdId)),
      loans.listLoans(ctx),
      accounts.listAccounts(ctx),
      recurring.listRecurring(ctx),
      portfolio.getPortfolio(ctx),
      db.select().from(zakatSettings).where(eq(zakatSettings.householdId, ctx.householdId)).then((r) => r[0] ?? null),
      db.execute(sql`
        select distinct on (quote) quote, rate::float8 as rate, as_of::text as as_of
        from fx_rates where base = ${ctx.baseCurrency} order by quote, as_of desc`).then((r) => r.rows),
    ])
  const payments = loanList.length
    ? await db.select().from(loanPayments).where(inArray(loanPayments.loanId, loanList.map((l) => l.id)))
    : []
  const data = {
    me, household: hh, categories, tags: tagList, transactions,
    budgets: budgetRows, loans: loanList, loan_payments: payments,
    accounts: accountList, recurring: recurringList, portfolio: portfolioData,
    zakat_settings: zakat, fx_rates: fx,
  }
  return { ...data, hash: hashOf(JSON.stringify(data)) }
}
