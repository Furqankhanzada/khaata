import crypto from 'node:crypto'

/** Today's date (YYYY-MM-DD) on a given IANA timezone's calendar — always the household's, never the server's. */
export function todayIn(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

/** True when ICU can resolve the IANA timezone name. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Month bounds for queries: from inclusive, to exclusive. month = 'YYYY-MM', defaults to the tz's current month. */
export function monthBounds(tz: string, month?: string) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : todayIn(tz).slice(0, 7)
  const [y, mo] = m.split('-').map(Number)
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`
  return { month: m, from: `${m}-01`, toExclusive: next }
}

/** True when ICU knows the ISO-4217 currency code. */
export function isValidCurrency(code: string): boolean {
  return /^[A-Z]{3}$/.test(code) && Intl.supportedValuesOf('currency').includes(code)
}

/** Display symbol for amounts in a household's base currency ('Rs 3,000', '$3,000', 'AED 3,000'). */
export function symbolFor(code: string): string {
  return { PKR: 'Rs', USD: '$', EUR: '\u20ac', GBP: '\u00a3', INR: '\u20b9' }[code] ?? code
}

export function newInviteCode(): string {
  return crypto.randomBytes(4).toString('hex')
}
