import crypto from 'node:crypto'

/** Today's date (YYYY-MM-DD) in Pakistan time. */
export function todayPk(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
}

/** Month bounds for queries: from inclusive, to exclusive. month = 'YYYY-MM', defaults to current. */
export function monthBounds(month?: string) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : todayPk().slice(0, 7)
  const [y, mo] = m.split('-').map(Number)
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`
  return { month: m, from: `${m}-01`, toExclusive: next }
}

export function newInviteCode(): string {
  return crypto.randomBytes(4).toString('hex')
}
