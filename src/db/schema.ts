import { pgTable, text, boolean, date, numeric, timestamp, integer, index, unique, primaryKey } from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

export * from './auth-schema'

// ponytail: text ids + crypto.randomUUID() everywhere — matches better-auth's text ids, no casts
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())

export const households = pgTable('households', {
  id: id(),
  name: text('name').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const categories = pgTable('categories', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['expense', 'income'] }).notNull(),
  archived: boolean('archived').notNull().default(false),
}, (t) => [unique().on(t.householdId, t.name, t.kind)])

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
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  categoryId: text('category_id').references(() => categories.id),
  note: text('note'),
  occurredOn: date('occurred_on').notNull(),
  source: text('source').notNull().default('api'),
  recurringRuleId: text('recurring_rule_id').references(() => recurringRules.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('transactions_household_date_idx').on(t.householdId, t.occurredOn.desc())])

export const budgets = pgTable('budgets', {
  householdId: text('household_id').notNull().references(() => households.id),
  categoryId: text('category_id').notNull().references(() => categories.id),
  monthlyAmount: numeric('monthly_amount', { precision: 14, scale: 2 }).notNull(),
}, (t) => [primaryKey({ columns: [t.householdId, t.categoryId] })])

// Manual snapshot balances only — deliberately not linked to transactions
export const accounts = pgTable('accounts', {
  id: id(),
  householdId: text('household_id').notNull().references(() => households.id),
  name: text('name').notNull(),
  balance: numeric('balance', { precision: 14, scale: 2 }).notNull().default('0'),
  zakatable: boolean('zakatable').notNull().default(true),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Global (shared across households): a PSX symbol / mutual fund is the same for everyone
export const instruments = pgTable('instruments', {
  id: id(),
  kind: text('kind', { enum: ['psx_stock', 'mutual_fund', 'other'] }).notNull(),
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
  note: text('note'),
})

export const prices = pgTable('prices', {
  instrumentId: text('instrument_id').notNull().references(() => instruments.id),
  asOf: date('as_of').notNull(),
  price: numeric('price', { precision: 14, scale: 4 }).notNull(),
  source: text('source', { enum: ['psx', 'mufap', 'manual'] }).notNull(),
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
})

export const loanPayments = pgTable('loan_payments', {
  id: id(),
  loanId: text('loan_id').notNull().references(() => loans.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  paidOn: date('paid_on').notNull(),
  note: text('note'),
})

export const zakatSettings = pgTable('zakat_settings', {
  householdId: text('household_id').primaryKey().references(() => households.id),
  nisabAmount: numeric('nisab_amount', { precision: 14, scale: 2 }).notNull(),
  nextDueDate: date('next_due_date'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})
