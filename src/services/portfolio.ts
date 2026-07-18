import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { holdings, instruments, prices } from '../db/schema'
import { todayPk } from '../util'
import type { Ctx } from '../middleware'
import { fetchPsxClose } from './prices/psx'
import { fetchMufapNavs, norm } from './prices/mufap'

export const instrumentInput = z.object({
  kind: z.enum(['psx_stock', 'mutual_fund', 'other']),
  symbol: z.string().optional().describe("PSX ticker, e.g. 'MEBL' (psx_stock only)"),
  mufap_fund_name: z.string().optional().describe('Exact fund name as it appears on mufap.com.pk (mutual_fund only)'),
  name: z.string().min(1).describe("Display name, e.g. 'Meezan Bank' or 'Gold jewellery'"),
})

export const holdingInput = z.object({
  instrument_id: z.string().optional(),
  instrument: instrumentInput.optional().describe('Create/find the instrument inline instead of passing instrument_id'),
  units: z.coerce.number().positive().describe('Units/shares held (1 for lump assets like gold or property)'),
  avg_cost: z.coerce.number().positive().optional().describe('Average buy price per unit in PKR'),
  zakatable: z.boolean().default(true),
  note: z.string().optional(),
})

export const holdingUpdate = z.object({
  units: z.coerce.number().min(0).optional().describe('New total units (0 deletes the holding)'),
  avg_cost: z.coerce.number().positive().optional(),
  zakatable: z.boolean().optional(),
  note: z.string().optional(),
})

export const priceInput = z.object({
  instrument_id: z.string(),
  price: z.coerce.number().positive().describe('Price/NAV/valuation per unit in PKR'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to today'),
})

export async function searchInstruments(search?: string) {
  const cond = search
    ? or(ilike(instruments.name, `%${search}%`), ilike(instruments.symbol, `%${search}%`), ilike(instruments.mufapFundName, `%${search}%`))
    : undefined
  return db.select().from(instruments).where(cond).orderBy(instruments.name).limit(50)
}

export async function createInstrument(input: z.infer<typeof instrumentInput>) {
  if (input.kind === 'psx_stock' && !input.symbol) throw new Error('psx_stock needs a symbol')
  if (input.kind === 'mutual_fund' && !input.mufap_fund_name) throw new Error('mutual_fund needs mufap_fund_name for auto NAV (see mufap.com.pk daily NAV table)')
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
    .values({ kind: input.kind, symbol, mufapFundName: input.mufap_fund_name, name: input.name })
    .returning()
  return row
}

export async function addHolding(ctx: Ctx, input: z.infer<typeof holdingInput>) {
  let instrumentId = input.instrument_id
  if (!instrumentId) {
    if (!input.instrument) throw new Error('pass instrument_id or instrument')
    instrumentId = (await createInstrument(input.instrument)).id
  }
  const [row] = await db.insert(holdings).values({
    householdId: ctx.householdId,
    instrumentId,
    userId: ctx.userId,
    units: input.units.toFixed(6),
    avgCost: input.avg_cost?.toFixed(4),
    zakatable: input.zakatable,
    note: input.note,
  }).returning()
  return row
}

export async function updateHolding(ctx: Ctx, id: string, input: z.infer<typeof holdingUpdate>) {
  if (input.units === 0) {
    const rows = await db.delete(holdings)
      .where(and(eq(holdings.id, id), eq(holdings.householdId, ctx.householdId)))
      .returning({ id: holdings.id })
    return rows.length ? { id, deleted: true } : null
  }
  const [row] = await db.update(holdings).set({
    units: input.units !== undefined ? input.units.toFixed(6) : undefined,
    avgCost: input.avg_cost !== undefined ? input.avg_cost.toFixed(4) : undefined,
    zakatable: input.zakatable,
    note: input.note,
  }).where(and(eq(holdings.id, id), eq(holdings.householdId, ctx.householdId))).returning()
  return row ?? null
}

export async function getPortfolio(ctx: Ctx) {
  const { rows } = await db.execute(sql`
    select h.id as holding_id, i.id as instrument_id, i.kind, i.symbol, i.name,
           h.units::float8 as units, h.avg_cost::float8 as avg_cost, h.zakatable, h.note,
           p.price::float8 as price, p.as_of::text as price_as_of, p.source as price_source,
           (h.units * p.price)::float8 as value,
           (h.units * h.avg_cost)::float8 as cost,
           (h.units * p.price - h.units * h.avg_cost)::float8 as gain
    from holdings h
    join instruments i on i.id = h.instrument_id
    left join lateral (
      select price, as_of, source from prices where instrument_id = i.id order by as_of desc limit 1
    ) p on true
    where h.household_id = ${ctx.householdId}
    order by value desc nulls last`)
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
    currency: 'PKR',
  }
}

export async function recordPrice(input: z.infer<typeof priceInput>) {
  const asOf = input.as_of ?? todayPk()
  const [row] = await db.insert(prices)
    .values({ instrumentId: input.instrument_id, asOf, price: input.price.toFixed(4), source: 'manual' })
    .onConflictDoUpdate({
      target: [prices.instrumentId, prices.asOf],
      set: { price: input.price.toFixed(4), source: 'manual' },
    }).returning()
  return row
}

async function upsertFetchedPrice(instrumentId: string, asOf: string, price: number, source: 'psx' | 'mufap') {
  // manual entries win over fetched ones for the same day
  await db.execute(sql`
    insert into prices (instrument_id, as_of, price, source)
    values (${instrumentId}, ${asOf}, ${price.toFixed(4)}, ${source})
    on conflict (instrument_id, as_of) do update
    set price = excluded.price, source = excluded.source
    where prices.source != 'manual'`)
}

/** Fetch PSX closes + MUFAP NAVs for every instrument that someone holds. */
export async function refreshPrices() {
  const held = await db.selectDistinct({
    id: instruments.id, kind: instruments.kind, symbol: instruments.symbol, mufapFundName: instruments.mufapFundName,
  }).from(instruments).innerJoin(holdings, eq(holdings.instrumentId, instruments.id))

  const result = { updated: 0, skipped: 0, errors: [] as string[] }

  for (const inst of held.filter(i => i.kind === 'psx_stock' && i.symbol)) {
    try {
      const close = await fetchPsxClose(inst.symbol!)
      if (close) { await upsertFetchedPrice(inst.id, close.asOf, close.price, 'psx'); result.updated++ }
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
        if (nav) { await upsertFetchedPrice(inst.id, nav.asOf, nav.nav, 'mufap'); result.updated++ }
        else { result.errors.push(`MUFAP: fund name not found in NAV table: "${inst.mufapFundName}"`) }
      }
    } catch (e) {
      result.errors.push(`MUFAP: ${(e as Error).message}`)
    }
  }

  result.skipped = held.length - result.updated
  if (result.errors.length) console.warn('[prices]', result.errors.join('; '))
  return result
}
