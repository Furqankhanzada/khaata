import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { accounts, fxRates } from '../db/schema'
import { todayPk } from '../util'

export const BASE = 'PKR'
export const COMMON_CURRENCIES = ['PKR', 'USD', 'AED', 'MYR', 'TRY', 'SAR', 'EUR', 'GBP']

export const currencyCode = z.string().length(3).toUpperCase()
  .describe("ISO-4217 currency code, e.g. 'USD'")

export const fxRateInput = z.object({
  currency: currencyCode,
  rate: z.coerce.number().positive().describe('PKR per 1 unit of the currency, e.g. 280 for USD'),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Defaults to today'),
})

async function storedRate(quote: string): Promise<number | null> {
  const [row] = await db.select().from(fxRates)
    .where(and(eq(fxRates.base, BASE), eq(fxRates.quote, quote)))
    .orderBy(desc(fxRates.asOf)).limit(1)
  return row ? Number(row.rate) : null
}

async function upsertRate(quote: string, asOf: string, rate: number) {
  await db.insert(fxRates).values({ base: BASE, quote, asOf, rate: rate.toFixed(8) })
    .onConflictDoUpdate({ target: [fxRates.base, fxRates.quote, fxRates.asOf], set: { rate: rate.toFixed(8) } })
}

/** Fetch today's rates (er-api returns PKR→quote; we store the inverse: PKR per 1 quote). */
async function fetchAndStore(wanted: string[]): Promise<void> {
  const res = await fetch(`https://open.er-api.com/v6/latest/${BASE}`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`fx API ${res.status}`)
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> }
  if (body.result !== 'success' || !body.rates) throw new Error('fx API returned no rates')
  const asOf = todayPk()
  for (const q of wanted) {
    const pkrToQuote = body.rates[q]
    if (pkrToQuote && pkrToQuote > 0) await upsertRate(q, asOf, 1 / pkrToQuote)
  }
}

/** PKR per 1 unit of `quote`. Uses newest stored rate; live-fetches on miss. */
export async function latestRate(quote: string): Promise<number> {
  if (quote === BASE) return 1
  const stored = await storedRate(quote)
  if (stored) return stored
  try {
    await fetchAndStore([...new Set([...COMMON_CURRENCIES.filter((c) => c !== BASE), quote])])
  } catch (e) {
    throw new Error(`Exchange rate for ${quote} unavailable (${(e as Error).message}) — record one manually with record_fx_rate / POST /api/v1/fx/rates`)
  }
  const fetched = await storedRate(quote)
  if (!fetched) throw new Error(`Currency ${quote} not found in the exchange-rate feed — record a rate manually`)
  return fetched
}

export async function recordFxRate(input: z.infer<typeof fxRateInput>) {
  const asOf = input.as_of ?? todayPk()
  await upsertRate(input.currency, asOf, input.rate)
  return { base: BASE, currency: input.currency, as_of: asOf, rate: input.rate }
}

/** Daily job: refresh rates for currencies actually in use plus the common set. */
export async function refreshFxRates() {
  const used = await db.selectDistinct({ c: accounts.currency }).from(accounts)
  const wanted = [...new Set([...COMMON_CURRENCIES, ...used.map((r) => r.c)])].filter((c) => c !== BASE)
  try {
    await fetchAndStore(wanted)
    return { updated: wanted.length }
  } catch (e) {
    console.warn('[fx]', (e as Error).message)
    return { updated: 0, error: (e as Error).message }
  }
}
