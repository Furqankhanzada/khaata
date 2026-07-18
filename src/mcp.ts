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

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] })

function buildServer(ctx: Ctx) {
  const server = new McpServer({ name: 'khaata', version: '1.0.0' })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (name: string, description: string, shape: z.ZodRawShape, handler: (args: any) => Promise<unknown>) =>
    server.registerTool(name, { description, inputSchema: shape }, async (args) => json(await handler(args)))

  tool('add_transaction', 'Record an expense or income in the household ledger (amounts in PKR). The payer is the owner of the API key.',
    tx.transactionInput.shape, (a) => tx.addTransaction(ctx, a))
  tool('list_transactions', 'List/search household transactions with optional date, type, category, member and text filters.',
    tx.transactionFilters.shape, (a) => tx.listTransactions(ctx, tx.transactionFilters.parse(a)))
  tool('update_transaction', 'Fix an existing transaction by id (any field).',
    { id: z.string(), ...tx.transactionUpdate.shape },
    async (a: { id: string }) => (await tx.updateTransaction(ctx, a.id, tx.transactionUpdate.parse(a))) ?? { error: 'not found' })
  tool('delete_transaction', 'Delete a transaction by id.',
    { id: z.string() }, async (a: { id: string }) => ({ deleted: await tx.deleteTransaction(ctx, a.id) }))

  tool('list_categories', 'List expense and income categories of the household.', {}, () => tx.listCategories(ctx))
  tool('add_category', 'Add a new category.', tx.categoryInput.shape, (a) => tx.addCategory(ctx, a))

  tool('get_budget_status', 'Per-category spent vs monthly budget cap for a month (default: current month).',
    { month: z.string().optional().describe('YYYY-MM') }, (a: { month?: string }) => budgets.budgetStatus(ctx, a.month))
  tool('set_budget', 'Set (or remove with 0) the monthly budget cap for a category.',
    { category_id: z.string(), ...budgets.budgetInput.shape },
    (a: { category_id: string; monthly_amount: number }) => budgets.setBudget(ctx, a.category_id, a.monthly_amount))

  tool('get_monthly_report', 'Monthly summary: income, expense, net, category breakdown, per-member split, budget compare.',
    { month: z.string().optional().describe('YYYY-MM') }, (a: { month?: string }) => reports.monthlyReport(ctx, a.month))

  tool('get_portfolio', 'Investment holdings with latest prices/NAVs, current value, cost and gain (PKR).',
    {}, () => portfolio.getPortfolio(ctx))
  tool('list_instruments', 'Search known instruments (PSX stocks, mutual funds, other assets).',
    { search: z.string().optional() }, (a: { search?: string }) => portfolio.searchInstruments(a.search))
  tool('add_holding', 'Add an investment holding; pass instrument_id, or instrument {kind, symbol|mufap_fund_name, name} to create one.',
    portfolio.holdingInput.shape, (a) => portfolio.addHolding(ctx, portfolio.holdingInput.parse(a)))
  tool('update_holding', 'Adjust units (0 deletes), avg cost or zakatable flag of a holding after a buy/sell.',
    { holding_id: z.string(), ...portfolio.holdingUpdate.shape },
    async (a: { holding_id: string }) => (await portfolio.updateHolding(ctx, a.holding_id, portfolio.holdingUpdate.parse(a))) ?? { error: 'not found' })
  tool('record_price', 'Manually record a price/NAV/valuation for an instrument (wins over auto-fetched prices).',
    portfolio.priceInput.shape, (a) => portfolio.recordPrice(portfolio.priceInput.parse(a)))
  tool('refresh_prices', 'Fetch latest PSX closing prices and MUFAP fund NAVs now.', {}, () => portfolio.refreshPrices())

  tool('add_loan', 'Record money lent to or borrowed from someone (qarz).', loans.loanInput.shape, (a) => loans.addLoan(ctx, loans.loanInput.parse(a)))
  tool('list_loans', 'List loans with outstanding amounts; filter by status open|settled.',
    { status: z.enum(['open', 'settled']).optional() }, (a: { status?: 'open' | 'settled' }) => loans.listLoans(ctx, a.status))
  tool('record_loan_payment', 'Record a repayment against a loan (auto-settles when fully repaid).',
    { loan_id: z.string(), ...loans.loanPaymentInput.shape },
    async (a: { loan_id: string }) => (await loans.addLoanPayment(ctx, a.loan_id, loans.loanPaymentInput.parse(a))) ?? { error: 'not found' })

  tool('add_recurring', 'Create a recurring monthly bill/income rule (auto-logged on its due day).',
    recurring.recurringInput.shape, (a) => recurring.addRecurring(ctx, recurring.recurringInput.parse(a)))
  tool('list_recurring', 'List recurring rules.', {}, () => recurring.listRecurring(ctx))
  tool('update_recurring', 'Update or deactivate (active:false) a recurring rule.',
    { id: z.string(), ...recurring.recurringUpdate.shape },
    async (a: { id: string }) => (await recurring.updateRecurring(ctx, a.id, recurring.recurringUpdate.parse(a))) ?? { error: 'not found' })

  tool('list_accounts', 'List cash/bank accounts with snapshot balances.', {}, () => accounts.listAccounts(ctx))
  tool('update_account_balance', 'Update a cash/bank account balance snapshot (or other fields).',
    { account_id: z.string(), ...accounts.accountUpdate.shape },
    async (a: { account_id: string }) => (await accounts.updateAccount(ctx, a.account_id, accounts.accountUpdate.parse(a))) ?? { error: 'not found' })
  tool('add_account', 'Create a cash/bank account.', accounts.accountInput.shape, (a) => accounts.addAccount(ctx, accounts.accountInput.parse(a)))

  tool('get_zakat_summary', 'Zakatable assets vs nisab and computed 2.5% zakat due.', {}, () => zakat.zakatSummary(ctx))
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
