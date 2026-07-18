const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * Latest closing price from the PSX data portal (unofficial endpoint — fail soft).
 * EOD rows are [unix_ts, close, volume, open] — close is index 1, NOT index 3.
 */
export async function fetchPsxClose(symbol: string): Promise<{ asOf: string; price: number } | null> {
  const res = await fetch(`https://dps.psx.com.pk/timeseries/eod/${encodeURIComponent(symbol)}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { data?: [number, number, number, number][] }
  const row = body.data?.[0]
  if (!row || typeof row[1] !== 'number') return null
  const asOf = new Date(row[0] * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
  return { asOf, price: row[1] }
}
