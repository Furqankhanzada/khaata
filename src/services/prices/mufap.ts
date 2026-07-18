import * as cheerio from 'cheerio'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export type NavRow = { nav: number; asOf: string }

/** Collapse whitespace — MUFAP pads cell text heavily. */
export const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Scrape the MUFAP daily NAV table (all Pakistani open-end funds, incl. Meezan & Mahaana).
 * Header columns are located by name so column order changes don't break us.
 * Returns Map keyed by exact fund name.
 */
export async function fetchMufapNavs(): Promise<Map<string, NavRow>> {
  const res = await fetch('https://www.mufap.com.pk/Industry/IndustryStatDaily?tab=3', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`MUFAP fetch failed: ${res.status}`)
  const $ = cheerio.load(await res.text())
  const out = new Map<string, NavRow>()

  $('table').each((_, table) => {
    const headers = $(table).find('tr').first().find('th,td')
      .map((_, el) => norm($(el).text()).toLowerCase()).get()
    const nameIdx = headers.findIndex(h => h === 'fund' || h.includes('fund name'))
    const navIdx = headers.findIndex(h => h === 'nav')
    const dateIdx = headers.findIndex(h => h.includes('validity'))
    if (nameIdx < 0 || navIdx < 0) return

    $(table).find('tr').slice(1).each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => norm($(td).text())).get()
      const name = cells[nameIdx]
      const nav = Number(cells[navIdx]?.replace(/,/g, ''))
      if (!name || !Number.isFinite(nav) || nav <= 0) return
      const parsed = dateIdx >= 0 ? new Date(cells[dateIdx]) : new Date()
      const asOf = Number.isNaN(parsed.getTime())
        ? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
        : parsed.toLocaleDateString('en-CA')
      out.set(name, { nav, asOf })
    })
  })
  return out
}
