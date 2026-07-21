import { Hono } from 'hono'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPTransport } from '@hono/mcp'
import { z } from 'zod'
import { apiKeyFrom, ctxFromApiKey, type Ctx } from './middleware'
import * as tx from './services/transactions'
import * as budgets from './services/budgets'
import * as reports from './services/reports'
import * as portfolio from './services/portfolio'
import * as loans from './services/loans'
import * as recurring from './services/recurring'
import * as accounts from './services/accounts'
import * as zakat from './services/zakat'
import * as fx from './services/fx'
import * as brief from './services/brief'
import * as household from './services/household'
import { audit, listAudit } from './services/audit'
import { isValidTimezone } from './util'

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] })

function buildServer(ctx: Ctx) {
  const server = new McpServer({ name: 'hamara-hisaab', version: '1.0.0' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (name: string, description: string, shape: z.ZodRawShape, handler: (args: any) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema: shape }, async (args) => {
      console.log(`[mcp] user=${ctx.userId} ${name} ${JSON.stringify(args)}`)
      const result = json(await handler(args))
      if (!/^(list_|get_)/.test(name)) await audit({ channel: 'mcp', action: name, detail: args, ...ctx })
      return result
    })

  tool('add_transaction', "Record an expense or income in the household ledger. Amounts are in the household base currency by default; for foreign spending pass currency (e.g. amount: 20, currency: 'USD') — it's converted to the base once at the day's rate (or an explicit fx_rate) and the original is preserved. The payer is the owner of the API key. Split an itemised bill into one transaction per item and tag each with what it was — broad and specific together, e.g. chicken breast → tags ['meat','chicken'].",
    tx.transactionInput.shape, (a) => tx.addTransaction(ctx, a))
  tool('list_transactions', "List/search household transactions with optional date, type, category, tag, member and text filters. To total what was bought (meat, milk, fruit) use tags — q searches free text and will match unrelated notes, e.g. a 'chicken burger' dining entry is not meat.",
    tx.transactionFilters.shape, (a) => tx.listTransactions(ctx, tx.transactionFilters.parse(a)))
  tool('update_transaction', 'Fix an existing transaction by id (any field).',
    { ...tx.transactionUpdate.shape, id: z.string() },
    async (a: { id: string }) => (await tx.updateTransaction(ctx, a.id, tx.transactionUpdate.parse(a))) ?? { error: 'not found' })
  tool('delete_transaction', 'Delete a transaction by id.',
    { id: z.string() }, async (a: { id: string }) => ({ deleted: await tx.deleteTransaction(ctx, a.id) }))

  tool('list_categories', 'List expense and income categories of the household.', {}, () => tx.listCategories(ctx))
  tool('add_category', 'Add a new category.', tx.categoryInput.shape, (a) => tx.addCategory(ctx, a))

  tool("list_tags", "The household's tag vocabulary — what was bought (milk, meat, chicken, fruit…), a second axis to categories. Call this before tagging or querying by tag; tags outside this list are rejected.",
    {}, () => tx.listTags(ctx))
  tool('add_tag', 'Add a tag to the vocabulary. Only when the user names a genuinely new kind of item — prefer an existing tag over a near-duplicate.',
    tx.tagInput.shape, (a) => tx.addTag(ctx, a))

  tool('get_budget_status', 'Budget picture for a month (default current): per-category spent vs cap, overall totals, spending outside any budget (unbudgeted_spent), and month_elapsed_pct for pace judgement.',
    { month: z.string().optional().describe('YYYY-MM') }, (a: { month?: string }) => budgets.budgetStatus(ctx, a.month))
  tool('set_budget', 'Set (or remove with 0) the monthly budget cap for a category.',
    { category_id: z.string(), ...budgets.budgetInput.shape },
    (a: { category_id: string; monthly_amount: number }) => budgets.setBudget(ctx, a.category_id, a.monthly_amount))

  tool('get_daily_brief', "Composed morning brief in one call: yesterday's spending, month so far, budget pace warnings, bills due in the next 7 days, open loans, and a zakat-date reminder. The `text` field is ready to post to a family chat as-is.",
    {}, () => brief.dailyBrief(ctx))
  tool('get_monthly_report', 'Monthly summary: income, expense, net, category breakdown, per-tag breakdown (what was bought), per-member split, budget compare. by_tag totals overlap — an entry tagged meat+chicken counts in both — so they do not sum to the month total.',
    { month: z.string().optional().describe('YYYY-MM') }, (a: { month?: string }) => reports.monthlyReport(ctx, a.month))
  tool('get_report', 'Weekly/monthly/quarterly/yearly or custom-range report: totals, previous-period comparison, income/expense trend buckets, category, tag and member breakdowns. Best way to answer "how much did I spend on meat last month" — read by_tag (its totals overlap, so they do not sum to the period total).',
    {
      period: z.enum(['week', 'month', 'quarter', 'year']).default('month'),
      offset: z.coerce.number().int().max(0).default(0).describe('0 = current period, -1 = previous, …'),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Custom range start (use with to; overrides period)'),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Custom range end, inclusive'),
    },
    (a: reports.OverviewOpts) => reports.overviewReport(ctx, a))

  tool('get_portfolio', "Investment holdings visible to you (your own + household-shared) with latest prices/NAVs, value, cost and gain (household base currency). Wealth items are private per member by default; visibility: 'shared' exposes one to the household.",
    {}, () => portfolio.getPortfolio(ctx))
  tool('list_instruments', 'Search known instruments (global stocks/ETFs/crypto, PSX stocks, mutual funds, other assets).',
    { search: z.string().optional() }, (a: { search?: string }) => portfolio.searchInstruments(a.search))
  tool('add_holding', "Add an investment holding; pass instrument_id, or instrument {kind, symbol|mufap_fund_name, name} to create one. kind 'stock' covers global stocks/ETFs/crypto via Yahoo symbols (AAPL, VOO, BTC-USD).",
    portfolio.holdingInput.shape, (a) => portfolio.addHolding(ctx, portfolio.holdingInput.parse(a)))
  tool('update_holding', 'Adjust units, avg cost, visibility or zakatable flag of a holding after a buy/sell.',
    { holding_id: z.string(), ...portfolio.holdingUpdate.shape },
    async (a: { holding_id: string }) => (await portfolio.updateHolding(ctx, a.holding_id, portfolio.holdingUpdate.parse(a))) ?? { error: 'not found' })
  tool('delete_holding', 'Remove an investment holding from the portfolio (its price history is kept).',
    { holding_id: z.string() },
    async (a: { holding_id: string }) => (await portfolio.updateHolding(ctx, a.holding_id, { units: 0 })) ?? { error: 'not found' })
  tool('update_instrument', "Rename an investment's display name, e.g. 'Gold jewellery (5 tola)'. Only instruments your household holds can be renamed; the name is shared across the household.",
    { instrument_id: z.string(), ...portfolio.instrumentUpdate.shape },
    async (a: { instrument_id: string }) => (await portfolio.updateInstrument(ctx, a.instrument_id, portfolio.instrumentUpdate.parse(a))) ?? { error: 'not found' })
  tool('record_price', 'Manually record a price/NAV/valuation for an instrument (wins over auto-fetched prices).',
    portfolio.priceInput.shape, (a) => portfolio.recordPrice(ctx, portfolio.priceInput.parse(a)))
  tool('refresh_prices', 'Fetch latest market data now: global quotes (Yahoo), PSX closing prices, MUFAP fund NAVs, and exchange rates.', {}, () => portfolio.refreshPrices())

  tool('add_loan', 'Record money lent to or borrowed from someone (qarz).', loans.loanInput.shape, (a) => loans.addLoan(ctx, loans.loanInput.parse(a)))
  tool('list_loans', 'List loans visible to you (your own + household-shared) with outstanding amounts; filter by status open|settled.',
    { status: z.enum(['open', 'settled']).optional() }, (a: { status?: 'open' | 'settled' }) => loans.listLoans(ctx, a.status))
  tool('record_loan_payment', 'Record a repayment against a loan (auto-settles when fully repaid).',
    { loan_id: z.string(), ...loans.loanPaymentInput.shape },
    async (a: { loan_id: string }) => (await loans.addLoanPayment(ctx, a.loan_id, loans.loanPaymentInput.parse(a))) ?? { error: 'not found' })
  tool('update_loan', 'Settle a loan (any remainder counts as forgiven), reopen it, update its note, or change its visibility.',
    {
      loan_id: z.string(),
      status: z.enum(['open', 'settled']).optional(),
      note: z.string().optional(),
      visibility: z.enum(['shared', 'private']).optional(),
    },
    async (a: { loan_id: string; status?: 'open' | 'settled'; note?: string; visibility?: 'shared' | 'private' }) =>
      (await loans.updateLoan(ctx, a.loan_id, { status: a.status, note: a.note, visibility: a.visibility })) ?? { error: 'not found' })

  tool('add_recurring', 'Create a recurring monthly bill/income rule (auto-logged on its due day).',
    recurring.recurringInput.shape, (a) => recurring.addRecurring(ctx, recurring.recurringInput.parse(a)))
  tool('list_recurring', 'List recurring rules.', {}, () => recurring.listRecurring(ctx))
  tool('update_recurring', 'Update or deactivate (active:false) a recurring rule.',
    { ...recurring.recurringUpdate.shape, id: z.string() },
    async (a: { id: string }) => (await recurring.updateRecurring(ctx, a.id, recurring.recurringUpdate.parse(a))) ?? { error: 'not found' })

  tool('list_accounts', "List cash/bank accounts visible to you (your own + household-shared). Balances are in each account's own currency; base_balance/rate give the PKR value at the latest exchange rate.", {}, () => accounts.listAccounts(ctx))
  tool('update_account_balance', "Update a cash/bank account's balance snapshot (in its own currency) or other fields.",
    { account_id: z.string(), ...accounts.accountUpdate.shape },
    async (a: { account_id: string }) => (await accounts.updateAccount(ctx, a.account_id, accounts.accountUpdate.parse(a))) ?? { error: 'not found' })
  tool('add_account', "Create a cash/bank account. Use currency for foreign-currency balances (e.g. 'USD' for Payoneer/Upwork).", accounts.accountInput.shape, (a) => accounts.addAccount(ctx, accounts.accountInput.parse(a)))
  tool('delete_account', 'Delete a cash/bank account by id (its balance stops counting toward zakat).',
    { id: z.string() }, async (a: { id: string }) => ({ deleted: await accounts.deleteAccount(ctx, a.id) }))
  tool('record_fx_rate', 'Manually record an exchange rate (PKR per 1 unit of the currency) — used when the daily feed is wrong or unavailable.',
    fx.fxRateInput.shape, (a) => fx.recordFxRate(ctx.baseCurrency, fx.fxRateInput.parse(a)))

  tool('update_household', "Update household settings: rename, or change the household timezone (an IANA name like 'Asia/Karachi'; entry dates and reports follow this clock).",
    { name: z.string().min(1).optional(), timezone: z.string().optional() },
    async (a: { name?: string; timezone?: string }) => {
      if (a.timezone && !isValidTimezone(a.timezone)) return { error: 'invalid IANA timezone' }
      return household.updateHousehold(ctx, a)
    })

  tool('get_audit_log', "Audit trail: who did what and when — every create/update/delete by household members via app or agent. Other members' wealth actions (holdings/loans/accounts) are hidden per visibility rules.",
    { limit: z.coerce.number().int().min(1).max(200).default(50) }, (a: { limit: number }) => listAudit(ctx, a.limit))

  tool('get_zakat_summary', 'Zakatable assets visible to you (your own + household-shared) vs nisab, and the computed 2.5% zakat due.', {}, () => zakat.zakatSummary(ctx))
  tool('set_zakat_settings', 'Set the nisab threshold (PKR) and next zakat due date.',
    zakat.zakatSettingsInput.shape, (a) => zakat.setZakatSettings(ctx, zakat.zakatSettingsInput.parse(a)))

  return server
}

export const mcpApp = new Hono()

mcpApp.all('/', async (c) => {
  const key = apiKeyFrom({ 'x-api-key': c.req.header('x-api-key'), authorization: c.req.header('authorization') })
  if (!key) return c.json({ error: 'API key required: x-api-key header or Authorization: Bearer <key>' }, 401)
  const ctx = await ctxFromApiKey(key)
  if (!ctx) return c.json({ error: 'invalid API key' }, 401)
  if (!ctx.householdId) return c.json({ error: 'user has no household yet — create one in the web app first' }, 403)

  // ponytail: stateless — fresh server per request, no MCP session tracking
  const server = buildServer(ctx as Ctx)
  const transport = new StreamableHTTPTransport()
  await server.connect(transport)
  return transport.handleRequest(c)
})
