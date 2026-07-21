import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { accounts, fxRates, households } from '../db/schema'
import { todayIn } from '../util'

// PSX/MUFAP/fx feeds are Pakistan-market data; their "today" is the market's, not any household's
// (price-source seam for other markets: issue #4)
export const MARKET_TZ = 'Asia/Karachi'
export const marketToday = () => todayIn(MARKET_TZ)

export const COMMON_CURRENCIES = ['PKR', 'USD', 'AED', 'MYR', 'TRY', 'SAR', 'EUR', 'GBP']

export const currencyCode = z.string().length(3).toUpperCase()
  .describe("ISO-4217 currency code, e.g. 'USD'")

export const fxRateInput = z.object({
  currency: currencyCode,
  rate: z.coerce.number().positive().describe('Household base units per 1 unit of the currency, e.g. 280 PKR for USD'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to today'),
})

async function storedRate(base: string, quote: string): Promise<number | null> {
  const [row] = await db.select().from(fxRates)
    .where(and(eq(fxRates.base, base), eq(fxRates.quote, quote)))
    .orderBy(desc(fxRates.asOf)).limit(1)
  return row ? Number(row.rate) : null
}

async function upsertRate(base: string, quote: string, asOf: string, rate: number) {
  await db.insert(fxRates).values({ base, quote, asOf, rate: rate.toFixed(8) })
    .onConflictDoUpdate({ target: [fxRates.base, fxRates.quote, fxRates.asOf], set: { rate: rate.toFixed(8) } })
}

/** Fetch today's rates for one base (er-api returns base→quote; we store the inverse: base per 1 quote). */
async function fetchAndStore(base: string, wanted: string[]): Promise<void> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`fx API ${res.status}`)
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> }
  if (body.result !== 'success' || !body.rates) throw new Error('fx API returned no rates')
  const asOf = marketToday()
  for (const q of wanted) {
    const baseToQuote = body.rates[q]
    if (baseToQuote && baseToQuote > 0) await upsertRate(base, q, asOf, 1 / baseToQuote)
  }
}

/** `base` units per 1 unit of `quote`. Uses newest stored rate; live-fetches on miss. */
export async function latestRate(base: string, quote: string): Promise<number> {
  if (quote === base) return 1
  const stored = await storedRate(base, quote)
  if (stored) return stored
  try {
    await fetchAndStore(base, [...new Set([...COMMON_CURRENCIES.filter((c) => c !== base), quote])])
  } catch (e) {
    throw new Error(`Exchange rate for ${quote} unavailable (${(e as Error).message}) — record one manually with record_fx_rate / POST /api/v1/fx/rates`)
  }
  const fetched = await storedRate(base, quote)
  if (!fetched) throw new Error(`Currency ${quote} not found in the exchange-rate feed — record a rate manually`)
  return fetched
}

/** Latest stored base-per-quote rates as a map — read-only path, never live-fetches. */
export async function latestRatesMap(base: string): Promise<Record<string, number>> {
  const rows = await db.selectDistinctOn([fxRates.quote]).from(fxRates)
    .where(eq(fxRates.base, base))
    .orderBy(fxRates.quote, desc(fxRates.asOf))
  return Object.fromEntries(rows.map((r) => [r.quote, Number(r.rate)]))
}

export async function recordFxRate(base: string, input: z.infer<typeof fxRateInput>) {
  const asOf = input.as_of ?? marketToday()
  await upsertRate(base, input.currency, asOf, input.rate)
  return { base, currency: input.currency, as_of: asOf, rate: input.rate }
}

/** Daily job: refresh rates for every base currency in use, covering currencies actually used plus the common set. */
export async function refreshFxRates() {
  const bases = await db.selectDistinct({ c: households.baseCurrency }).from(households)
  const used = await db.selectDistinct({ c: accounts.currency }).from(accounts)
  let updated = 0
  for (const { c: base } of bases) {
    const wanted = [...new Set([...COMMON_CURRENCIES, ...used.map((r) => r.c)])].filter((c) => c !== base)
    try {
      await fetchAndStore(base, wanted)
      updated += wanted.length
    } catch (e) {
      console.warn('[fx]', base, (e as Error).message)
    }
  }
  return { updated }
}
