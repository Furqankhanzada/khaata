import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, date, numeric, timestamp, integer, index, unique, primaryKey, jsonb } from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

export * from './auth-schema'

// ponytail: text ids + crypto.randomUUID() everywhere — matches better-auth's text ids, no casts
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())

export const households = pgTable('households', {
  id: id(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  // both required at creation (captured in the web signup) — deliberately no product defaults.
  // base_currency is IMMUTABLE after creation: amounts are stored converted-to-base at locked
  // rates, so flipping the base later would misstate all history.
  timezone: text('timezone').notNull(),
  baseCurrency: text('base_currency').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const categories = pgTable('categories', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
  archived: boolean('archived').notNull().default(false),
}, (t) => [unique().on(t.householdId, t.name, t.kind)])

// What was bought, as a predefined household vocabulary (milk, meat, chicken, …). A second axis to
// categories: unlike a category name, a tag never matches by accident, so "spend on meat" is exact.
export const tags = pgTable('tags', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  archived: boolean('archived').notNull().default(false),
}, (t) => [unique().on(t.householdId, t.name)])

export const recurringRules = pgTable('recurring_rules', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  userId: text('user_id').notNull().references(() => user.id),
  type: text('type', { enum: ['expense', 'income'] }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  categoryId: text('category_id').references(() => categories.id),
  description: text('description').notNull(),
  dayOfMonth: integer('day_of_month').notNull(),
  active: boolean('active').notNull().default(true),
  lastMaterialized: date('last_materialized'),
})

export const transactions = pgTable('transactions', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  userId: text('user_id').notNull().references(() => user.id),
  type: text('type', { enum: ['expense', 'income'] }).notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(), // always PKR
  // set only for foreign entries: amount = original_amount × fx_rate, locked at entry
  originalAmount: numeric('original_amount', { precision: 14, scale: 2 }),
  originalCurrency: text('original_currency'),
  fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
  categoryId: text('category_id').references(() => categories.id),
  // names from the household's `tags` vocabulary; an entry counts under each of its tags
  tags: text('tags').array().notNull().default(sql`'{}'`),
  note: text('note'),
  occurredOn: date('occurred_on').notNull(),
  source: text('source').notNull().default('api'),
  recurringRuleId: text('recurring_rule_id').references(() => recurringRules.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('transactions_household_date_idx').on(t.householdId, t.occurredOn.desc()),
  index('transactions_tags_idx').using('gin', t.tags),
])

export const budgets = pgTable('budgets', {
  householdId: text('household_id').notNull().references(() => households.id),
  categoryId: text('category_id').notNull().references(() => categories.id),
  monthlyAmount: numeric('monthly_amount', { precision: 14, scale: 2 }).notNull(),
}, (t) => [primaryKey({ columns: [t.householdId, t.categoryId] })])

// Manual snapshot balances only — deliberately not linked to transactions
export const accounts = pgTable('accounts', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  userId: text('user_id').references(() => user.id), // owner; null = visible to all (legacy safety)
  name: text('name').notNull(),
  balance: numeric('balance', { precision: 14, scale: 2 }).notNull().default('0'), // in `currency`
  currency: text('currency').notNull().default('PKR'),
  zakatable: boolean('zakatable').notNull().default(true),
  visibility: text('visibility', { enum: ['shared', 'private'] }).notNull().default('private'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Global (shared across households): a PSX symbol / mutual fund is the same for everyone
export const instruments = pgTable('instruments', {
  id: id(),
  kind: text('kind', { enum: ['stock', 'psx_stock', 'mutual_fund', 'other'] }).notNull(),
  symbol: text('symbol').unique(),
  mufapFundName: text('mufap_fund_name').unique(), // exact string match against the MUFAP NAV table
  name: text('name').notNull(),
})

export const holdings = pgTable('holdings', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  instrumentId: text('instrument_id').notNull().references(() => instruments.id),
  userId: text('user_id').references(() => user.id), // optional owner within the household
  units: numeric('units', { precision: 18, scale: 6 }).notNull(),
  avgCost: numeric('avg_cost', { precision: 14, scale: 4 }),
  zakatable: boolean('zakatable').notNull().default(true),
  visibility: text('visibility', { enum: ['shared', 'private'] }).notNull().default('private'),
  note: text('note'),
})

export const prices = pgTable('prices', {
  instrumentId: text('instrument_id').notNull().references(() => instruments.id),
  asOf: date('as_of').notNull(),
  price: numeric('price', { precision: 14, scale: 4 }).notNull(),
  // PSX/MUFAP feeds quote in PKR (a data-source fact, hence a real default);
  // manual valuations record in the household's base currency
  currency: text('currency').notNull().default('PKR'),
  source: text('source', { enum: ['psx', 'mufap', 'yahoo', 'manual'] }).notNull(),
}, (t) => [primaryKey({ columns: [t.instrumentId, t.asOf] })])

export const loans = pgTable('loans', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  userId: text('user_id').notNull().references(() => user.id),
  counterparty: text('counterparty').notNull(),
  direction: text('direction', { enum: ['lent', 'borrowed'] }).notNull(),
  principal: numeric('principal', { precision: 14, scale: 2 }).notNull(),
  startDate: date('start_date').notNull(),
  note: text('note'),
  status: text('status', { enum: ['open', 'settled'] }).notNull().default('open'),
  visibility: text('visibility', { enum: ['shared', 'private'] }).notNull().default('private'),
})

export const loanPayments = pgTable('loan_payments', {
  id: id(),
  loanId: text('loan_id').notNull().references(() => loans.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  paidOn: date('paid_on').notNull(),
  note: text('note'),
})

// rate = PKR (base) units per 1 quote unit; the er-api response is base→quote, so invert on ingest
export const fxRates = pgTable('fx_rates', {
  base: text('base').notNull(),
  quote: text('quote').notNull(),
  asOf: date('as_of').notNull(),
  rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
}, (t) => [primaryKey({ columns: [t.base, t.quote, t.asOf] })])

export const zakatSettings = pgTable('zakat_settings', {
  householdId: text('household_id').primaryKey().references(() => households.id),
  nisabAmount: numeric('nisab_amount', { precision: 14, scale: 2 }).notNull(),
  nextDueDate: date('next_due_date'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Every successful mutation (REST + MCP), purged after 30 days — no FKs so rows outlive their referents
export const auditLog = pgTable('audit_log', {
  id: id(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  householdId: text('household_id'),
  userId: text('user_id'),
  channel: text('channel', { enum: ['api', 'mcp'] }).notNull(),
  action: text('action').notNull(), // MCP tool name, or "PATCH /api/v1/transactions/<id>"
  detail: jsonb('detail'), // request args/body verbatim
}, (t) => [index('audit_log_at_idx').on(t.at)])
