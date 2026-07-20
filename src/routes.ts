import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from './db/client'
import { user } from './db/schema'
import { requireAuth, requireHousehold, hctx, type AuthEnv } from './middleware'
import * as tx from './services/transactions'
import * as budgets from './services/budgets'
import * as reports from './services/reports'
import * as household from './services/household'
import * as portfolio from './services/portfolio'
import * as loans from './services/loans'
import * as recurring from './services/recurring'
import * as accounts from './services/accounts'
import * as zakat from './services/zakat'
import * as fx from './services/fx'
import * as brief from './services/brief'
import { audit, listAudit } from './services/audit'
import { getSnapshot } from './services/snapshot'

// ponytail: single routes file — every handler is parse → service → json
export const api = new Hono<AuthEnv>()

api.use('*', requireAuth)

// audit every successful mutation; clone() so handlers can still read the body themselves
api.use('*', async (c, next) => {
  const mutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(c.req.method)
  const body = mutating ? await c.req.raw.clone().json().catch(() => undefined) : undefined
  await next()
  if (mutating && c.res.status < 400)
    await audit({ channel: 'api', action: `${c.req.method} ${c.req.path}`, detail: body,
      userId: c.get('userId'), householdId: c.get('householdId') })
})

// --- available before joining a household ---
api.get('/me', async (c) => {
  const [u] = await db.select({ id: user.id, name: user.name, email: user.email, householdId: user.householdId })
    .from(user).where(eq(user.id, c.get('userId')))
  const h = u?.householdId ? await household.getHousehold({ userId: u.id, householdId: u.householdId }) : null
  return c.json({ user: u, household: h })
})

api.post('/household', async (c) => {
  const body = z.object({ name: z.string().optional(), invite_code: z.string().optional() }).parse(await c.req.json())
  if (c.get('householdId')) return c.json({ error: 'already in a household' }, 409)
  if (body.invite_code) {
    const h = await household.joinHousehold(c.get('userId'), body.invite_code)
    return h ? c.json(h) : c.json({ error: 'invalid invite code' }, 404)
  }
  if (!body.name) return c.json({ error: 'pass name (create) or invite_code (join)' }, 400)
  return c.json(await household.createHousehold(c.get('userId'), body.name))
})

// --- everything below needs a household ---
api.use('*', requireHousehold)

api.get('/household', async (c) => c.json(await household.getHousehold(hctx(c))))
api.get('/snapshot', async (c) => {
  const snap = await getSnapshot(hctx(c))
  const etag = `"${snap.hash}"`
  c.header('ETag', etag)
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304)
  return c.json(snap)
})
api.get('/audit', async (c) =>
  c.json(await listAudit(hctx(c), z.coerce.number().int().min(1).max(200).default(50).parse(c.req.query('limit')))))
api.post('/household/rotate-invite', async (c) => c.json(await household.rotateInvite(hctx(c))))

api.post('/transactions', async (c) => c.json(await tx.addTransaction(hctx(c), tx.transactionInput.parse(await c.req.json())), 201))
api.get('/transactions', async (c) => c.json(await tx.listTransactions(hctx(c), tx.transactionFilters.parse(c.req.query()))))
api.get('/transactions/:id', async (c) => {
  const row = await tx.getTransaction(hctx(c), c.req.param('id'))
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.patch('/transactions/:id', async (c) => {
  const row = await tx.updateTransaction(hctx(c), c.req.param('id'), tx.transactionUpdate.parse(await c.req.json()))
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.delete('/transactions/:id', async (c) =>
  (await tx.deleteTransaction(hctx(c), c.req.param('id'))) ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404))

api.get('/categories', async (c) => c.json(await tx.listCategories(hctx(c))))
api.post('/categories', async (c) => c.json(await tx.addCategory(hctx(c), tx.categoryInput.parse(await c.req.json())), 201))

api.get('/budgets', async (c) => c.json(await budgets.listBudgets(hctx(c))))
api.get('/budgets/status', async (c) => c.json(await budgets.budgetStatus(hctx(c), c.req.query('month'))))
api.put('/budgets/:categoryId', async (c) => {
  const body = budgets.budgetInput.parse(await c.req.json())
  return c.json(await budgets.setBudget(hctx(c), c.req.param('categoryId'), body.monthly_amount))
})

api.get('/reports/monthly', async (c) => c.json(await reports.monthlyReport(hctx(c), c.req.query('month'))))
api.get('/reports/brief', async (c) => c.json(await brief.dailyBrief(hctx(c))))
api.get('/reports/overview', async (c) => {
  const q = z.object({
    period: z.enum(['week', 'month', 'quarter', 'year']).default('month'),
    offset: z.coerce.number().int().min(-600).max(0).default(0),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).refine((v) => !!v.from === !!v.to, { message: 'from and to must be passed together' })
    .parse(c.req.query())
  return c.json(await reports.overviewReport(hctx(c), q))
})

api.get('/portfolio', async (c) => c.json(await portfolio.getPortfolio(hctx(c))))
api.get('/instruments', async (c) => c.json(await portfolio.searchInstruments(c.req.query('search'))))
api.post('/instruments', async (c) => c.json(await portfolio.createInstrument(portfolio.instrumentInput.parse(await c.req.json())), 201))
api.patch('/instruments/:id', async (c) => {
  const row = await portfolio.updateInstrument(hctx(c), c.req.param('id'), portfolio.instrumentUpdate.parse(await c.req.json()))
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.post('/holdings', async (c) => c.json(await portfolio.addHolding(hctx(c), portfolio.holdingInput.parse(await c.req.json())), 201))
api.patch('/holdings/:id', async (c) => {
  const row = await portfolio.updateHolding(hctx(c), c.req.param('id'), portfolio.holdingUpdate.parse(await c.req.json()))
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.delete('/holdings/:id', async (c) => {
  const row = await portfolio.updateHolding(hctx(c), c.req.param('id'), { units: 0 })
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.post('/prices', async (c) => c.json(await portfolio.recordPrice(portfolio.priceInput.parse(await c.req.json())), 201))
api.post('/prices/refresh', async (c) => c.json(await portfolio.refreshPrices()))
api.post('/fx/rates', async (c) => c.json(await fx.recordFxRate(fx.fxRateInput.parse(await c.req.json())), 201))

api.get('/loans', async (c) => c.json(await loans.listLoans(hctx(c), c.req.query('status') as 'open' | 'settled' | undefined)))
api.post('/loans', async (c) => c.json(await loans.addLoan(hctx(c), loans.loanInput.parse(await c.req.json())), 201))
api.get('/loans/:id', async (c) => {
  const row = await loans.getLoan(hctx(c), c.req.param('id'))
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.patch('/loans/:id', async (c) => {
  const body = z.object({
    status: z.enum(['open', 'settled']).optional(),
    note: z.string().optional(),
    visibility: z.enum(['shared', 'private']).optional(),
  }).parse(await c.req.json())
  const row = await loans.updateLoan(hctx(c), c.req.param('id'), body)
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.post('/loans/:id/payments', async (c) => {
  const row = await loans.addLoanPayment(hctx(c), c.req.param('id'), loans.loanPaymentInput.parse(await c.req.json()))
  return row ? c.json(row, 201) : c.json({ error: 'not found' }, 404)
})

api.get('/recurring', async (c) => c.json(await recurring.listRecurring(hctx(c))))
api.post('/recurring', async (c) => c.json(await recurring.addRecurring(hctx(c), recurring.recurringInput.parse(await c.req.json())), 201))
api.patch('/recurring/:id', async (c) => {
  const row = await recurring.updateRecurring(hctx(c), c.req.param('id'), recurring.recurringUpdate.parse(await c.req.json()))
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.delete('/recurring/:id', async (c) =>
  (await recurring.deleteRecurring(hctx(c), c.req.param('id'))) ? c.json({ deactivated: true }) : c.json({ error: 'not found' }, 404))

api.get('/accounts', async (c) => c.json(await accounts.listAccounts(hctx(c))))
api.post('/accounts', async (c) => c.json(await accounts.addAccount(hctx(c), accounts.accountInput.parse(await c.req.json())), 201))
api.patch('/accounts/:id', async (c) => {
  const row = await accounts.updateAccount(hctx(c), c.req.param('id'), accounts.accountUpdate.parse(await c.req.json()))
  return row ? c.json(row) : c.json({ error: 'not found' }, 404)
})
api.delete('/accounts/:id', async (c) =>
  (await accounts.deleteAccount(hctx(c), c.req.param('id'))) ? c.json({ deleted: true }) : c.json({ error: 'not found' }, 404))

api.get('/zakat', async (c) => c.json(await zakat.zakatSummary(hctx(c))))
api.put('/zakat/settings', async (c) => c.json(await zakat.setZakatSettings(hctx(c), zakat.zakatSettingsInput.parse(await c.req.json()))))
