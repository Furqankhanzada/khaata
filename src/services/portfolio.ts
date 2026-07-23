import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { holdings, instruments, prices } from '../db/schema'

import type { Ctx } from '../middleware'
import { visibilityInput } from './accounts'
import { fetchPsxClose } from './prices/psx'
import { fetchMufapNavs, norm } from './prices/mufap'
import { latestRatesMap, marketToday, refreshFxRates } from './fx'
import { fetchYahooQuote } from './prices/yahoo'

export const instrumentInput = z.object({
  id: z.string().uuid().optional().describe('Client-generated id — makes offline-sync replays idempotent'),
  kind: z.enum(['stock', 'psx_stock', 'mutual_fund', 'other']).describe("'stock' = global stock/ETF/crypto auto-priced via Yahoo symbol"),
  symbol: z.string().optional().describe("Ticker: PSX e.g. 'MEBL' (psx_stock), or Yahoo symbol e.g. 'AAPL', 'VOO', 'BTC-USD' (stock)"),
  mufap_fund_name: z.string().optional().describe('Exact fund name as it appears on mufap.com.pk (mutual_fund only)'),
  name: z.string().min(1).describe("Display name, e.g. 'Meezan Bank' or 'Gold jewellery'"),
})

export const holdingInput = z.object({
  id: z.string().uuid().optional().describe('Client-generated id — makes offline-sync replays idempotent'),
  instrument_id: z.string().optional(),
  instrument: instrumentInput.optional().describe('Create/find the instrument inline instead of passing instrument_id'),
  units: z.coerce.number().positive().describe('Units/shares held (1 for lump assets like gold or property)'),
  avg_cost: z.coerce.number().positive().optional().describe('Average buy price per unit in the household base currency'),
  zakatable: z.boolean().default(true),
  visibility: visibilityInput,
  note: z.string().optional(),
})

export const holdingUpdate = z.object({
  units: z.coerce.number().min(0).optional().describe('New total units (0 deletes the holding)'),
  avg_cost: z.coerce.number().positive().optional(),
  zakatable: z.boolean().optional(),
  visibility: visibilityInput.optional(),
  note: z.string().optional(),
})

export const priceInput = z.object({
  instrument_id: z.string(),
  price: z.coerce.number().positive().describe('Price/NAV/valuation per unit in PKR'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to today'),
})

export async function searchInstruments(search?: string, limit = 50, offset = 0) {
  const cond = search
    ? or(ilike(instruments.name, `%${search}%`), ilike(instruments.symbol, `%${search}%`), ilike(instruments.mufapFundName, `%${search}%`))
    : undefined
  return db.select().from(instruments).where(cond).orderBy(instruments.name).limit(limit).offset(offset)
}

export async function createInstrument(input: z.infer<typeof instrumentInput>) {
  if ((input.kind === 'psx_stock' || input.kind === 'stock') && !input.symbol) throw new Error(`${input.kind} needs a symbol`)
  if (input.kind === 'mutual_fund' && !input.mufap_fund_name) throw new Error('mutual_fund needs mufap_fund_name for auto NAV (see mufap.com.pk daily NAV table)')
  if (input.id) {
    const [existing] = await db.select().from(instruments).where(eq(instruments.id, input.id))
    if (existing) return existing // offline replay of an already-applied create
  }
  const symbol = input.symbol?.toUpperCase()
  if (symbol) {
    const [existing] = await db.select().from(instruments).where(eq(instruments.symbol, symbol))
    if (existing) return existing
  }
  if (input.mufap_fund_name) {
    const [existing] = await db.select().from(instruments).where(eq(instruments.mufapFundName, input.mufap_fund_name))
    if (existing) return existing
  }
  const [row] = await db.insert(instruments)
    .values({ id: input.id, kind: input.kind, symbol, mufapFundName: input.mufap_fund_name, name: input.name })
    .returning()
  return row
}

export const instrumentUpdate = z.object({ name: z.string().min(1).describe('New display name') })

/** Rename an instrument's display name — only if the caller holds it (respecting privacy). */
export async function updateInstrument(ctx: Ctx, id: string, input: z.infer<typeof instrumentUpdate>) {
  const [held] = await db.select({ id: holdings.id }).from(holdings)
    .where(and(eq(holdings.instrumentId, id), eq(holdings.householdId, ctx.householdId), holdingVisibleTo(ctx.userId))).limit(1)
  if (!held) return null
  const [row] = await db.update(instruments).set({ name: input.name }).where(eq(instruments.id, id)).returning()
  return row ?? null
}

export async function addHolding(ctx: Ctx, input: z.infer<typeof holdingInput>) {
  // check the client id up front so a replay doesn't re-run instrument creation
  if (input.id) {
    const [existing] = await db.select().from(holdings)
      .where(and(eq(holdings.id, input.id), eq(holdings.householdId, ctx.householdId)))
    if (existing) return existing
  }
  let instrumentId = input.instrument_id
  if (!instrumentId) {
    if (!input.instrument) throw new Error('pass instrument_id or instrument')
    instrumentId = (await createInstrument(input.instrument)).id
  }
  const [row] = await db.insert(holdings).values({
    id: input.id,
    householdId: ctx.householdId,
    instrumentId,
    userId: ctx.userId,
    units: input.units.toFixed(6),
    avgCost: input.avg_cost?.toFixed(4),
    zakatable: input.zakatable,
    visibility: input.visibility,
    note: input.note,
  }).returning()
  return row
}

/** shared holdings, your own, and legacy unowned rows */
const holdingVisibleTo = (userId: string) =>
  or(eq(holdings.visibility, 'shared'), eq(holdings.userId, userId), isNull(holdings.userId))

export async function updateHolding(ctx: Ctx, id: string, input: z.infer<typeof holdingUpdate>) {
  const scope = and(eq(holdings.id, id), eq(holdings.householdId, ctx.householdId), holdingVisibleTo(ctx.userId))
  if (input.units === 0) {
    const rows = await db.delete(holdings).where(scope).returning({ id: holdings.id })
    return rows.length ? { id, deleted: true } : null
  }
  const [row] = await db.update(holdings).set({
    units: input.units !== undefined ? input.units.toFixed(6) : undefined,
    avgCost: input.avg_cost !== undefined ? input.avg_cost.toFixed(4) : undefined,
    zakatable: input.zakatable,
    visibility: input.visibility,
    note: input.note,
  }).where(scope).returning()
  return row ?? null
}

export async function getPortfolio(ctx: Ctx) {
  const { rows } = await db.execute(sql`
    select h.id as holding_id, i.id as instrument_id, i.kind, i.symbol, i.name,
           h.units::float8 as units, h.avg_cost::float8 as avg_cost, h.zakatable, h.visibility, h.note,
           p.price::float8 as price, p.currency as price_currency, p.as_of::text as price_as_of, p.source as price_source,
           (h.units * h.avg_cost)::float8 as cost
    from holdings h
    join instruments i on i.id = h.instrument_id
    left join lateral (
      select price, currency, as_of, source from prices where instrument_id = i.id order by as_of desc limit 1
    ) p on true
    where h.household_id = ${ctx.householdId}
      and (h.visibility = 'shared' or h.user_id = ${ctx.userId} or h.user_id is null)`)
  // price currency -> household base at the latest stored rate (1 when they match; null rate = unpriced)
  const fxMap = await latestRatesMap(ctx.baseCurrency)
  const rateFor = (c: string | null) => (c == null || c === ctx.baseCurrency ? 1 : (fxMap[c] ?? null))
  for (const r of rows as Record<string, unknown>[]) {
    const rate = r.price != null ? rateFor(r.price_currency as string) : null
    r.value = rate != null && r.price != null ? Number(r.units) * Number(r.price) * rate : null
    r.gain = r.value != null && r.cost != null ? Number(r.value) - Number(r.cost) : null
  }
  rows.sort((a, b) => (Number(b.value) || -1) - (Number(a.value) || -1))
  // gain only over priced holdings, so a missing NAV doesn't read as a loss
  const priced = rows.filter(r => r.value != null)
  const total = priced.reduce((s, r) => s + Number(r.value), 0)
  const totalCost = priced.reduce((s, r) => s + Number(r.cost ?? 0), 0)
  const unpriced = rows.length - priced.length
  return {
    holdings: rows,
    total_value: total,
    total_cost: totalCost,
    total_gain: total - totalCost,
    unpriced_holdings: unpriced || undefined,
    currency: ctx.baseCurrency,
  }
}

export async function recordPrice(ctx: Ctx, input: z.infer<typeof priceInput>) {
  const asOf = input.as_of ?? marketToday()
  // manual valuations are entered in the household's base currency
  const [row] = await db.insert(prices)
    .values({ instrumentId: input.instrument_id, asOf, price: input.price.toFixed(4), currency: ctx.baseCurrency, source: 'manual' })
    .onConflictDoUpdate({
      target: [prices.instrumentId, prices.asOf],
      set: { price: input.price.toFixed(4), currency: ctx.baseCurrency, source: 'manual' },
    }).returning()
  return row
}

async function upsertFetchedPrice(instrumentId: string, asOf: string, price: number, source: 'psx' | 'mufap' | 'yahoo', currency: string) {
  // manual entries win over fetched ones for the same day
  await db.execute(sql`
    insert into prices (instrument_id, as_of, price, currency, source)
    values (${instrumentId}, ${asOf}, ${price.toFixed(4)}, ${currency}, ${source})
    on conflict (instrument_id, as_of) do update
    set price = excluded.price, currency = excluded.currency, source = excluded.source
    where prices.source != 'manual'`)
}

/** Fetch PSX closes + MUFAP NAVs for every instrument that someone holds. */
export async function refreshPrices() {
  const held = await db.selectDistinct({
    id: instruments.id, kind: instruments.kind, symbol: instruments.symbol, mufapFundName: instruments.mufapFundName,
  }).from(instruments).innerJoin(holdings, eq(holdings.instrumentId, instruments.id))

  const result = { updated: 0, skipped: 0, errors: [] as string[] }

  for (const inst of held.filter(i => i.kind === 'stock' && i.symbol)) {
    try {
      const quote = await fetchYahooQuote(inst.symbol!)
      if (quote) { await upsertFetchedPrice(inst.id, quote.asOf, quote.price, 'yahoo', quote.currency); result.updated++ }
      else { result.errors.push(`Yahoo ${inst.symbol}: no data`) }
    } catch (e) {
      result.errors.push(`Yahoo ${inst.symbol}: ${(e as Error).message}`)
    }
  }

  for (const inst of held.filter(i => i.kind === 'psx_stock' && i.symbol)) {
    try {
      const close = await fetchPsxClose(inst.symbol!)
      if (close) { await upsertFetchedPrice(inst.id, close.asOf, close.price, 'psx', 'PKR'); result.updated++ }
      else { result.errors.push(`PSX ${inst.symbol}: no data`) }
    } catch (e) {
      result.errors.push(`PSX ${inst.symbol}: ${(e as Error).message}`)
    }
  }

  const fundInstruments = held.filter(i => i.kind === 'mutual_fund' && i.mufapFundName)
  if (fundInstruments.length) {
    try {
      const navs = await fetchMufapNavs()
      for (const inst of fundInstruments) {
        const nav = navs.get(norm(inst.mufapFundName!))
        if (nav) { await upsertFetchedPrice(inst.id, nav.asOf, nav.nav, 'mufap', 'PKR'); result.updated++ }
        else { result.errors.push(`MUFAP: fund name not found in NAV table: "${inst.mufapFundName}"`) }
      }
    } catch (e) {
      result.errors.push(`MUFAP: ${(e as Error).message}`)
    }
  }

  result.skipped = held.length - result.updated
  if (result.errors.length) console.warn('[prices]', result.errors.join('; '))
  // one "refresh market data" action: prices + FX rates together
  const fx = await refreshFxRates()
  return { ...result, fx_rates_updated: fx.updated }
}
