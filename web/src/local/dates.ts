// Client-side ports of src/util.ts + src/services/reports.ts date logic (keep in step with the server).

export type Period = 'week' | 'month' | 'quarter' | 'year'

// The household's timezone, seeded from the snapshot (localStorage survives reloads so the
// synchronous date helpers work before first sync); device timezone until a household exists.
let cachedTz: string | null = null
export function setAppTz(tz: string) {
  cachedTz = tz
  localStorage.setItem('hh-timezone', tz)
}
export function clearAppTz() {
  cachedTz = null
  localStorage.removeItem('hh-timezone')
}
export const appTz = () =>
  cachedTz ?? localStorage.getItem('hh-timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone

// Household base currency, seeded from the snapshot; 'PKR' only as the pre-sync placeholder.
let cachedBase: string | null = null
export function setAppBase(code: string) {
  cachedBase = code
  localStorage.setItem('hh-currency', code)
}
export function clearAppBase() {
  cachedBase = null
  localStorage.removeItem('hh-currency')
}
export const appBase = () => cachedBase ?? localStorage.getItem('hh-currency') ?? 'PKR'

/** Today on the household's calendar as YYYY-MM-DD. */
export const todayApp = () => new Date().toLocaleDateString('en-CA', { timeZone: appTz() })

export function monthBounds(month?: string) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : todayApp().slice(0, 7)
  const [y, mo] = m.split('-').map(Number)
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`
  return { month: m, from: `${m}-01`, toExclusive: next }
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type Range = { from: string; toExclusive: string; label: string; step: '1 day' | '7 days' | '1 month' }

export function periodRange(period: Period, offset: number): Range {
  const [y, m, d] = todayApp().split('-').map(Number)
  const today = new Date(y, m - 1, d)
  let start: Date, end: Date, label: string, step: Range['step']

  if (period === 'week') {
    start = addDays(today, -((today.getDay() + 6) % 7) + offset * 7)
    end = addDays(start, 7)
    const last = addDays(end, -1)
    label = `${start.getDate()} ${MONTHS[start.getMonth()]} – ${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`
    step = '1 day'
  } else if (period === 'month') {
    start = addMonths(new Date(y, m - 1, 1), offset)
    end = addMonths(start, 1)
    label = `${start.toLocaleDateString('en-PK', { month: 'long' })} ${start.getFullYear()}`
    step = '7 days'
  } else if (period === 'quarter') {
    start = addMonths(new Date(y, Math.floor((m - 1) / 3) * 3, 1), offset * 3)
    end = addMonths(start, 3)
    label = `Q${Math.floor(start.getMonth() / 3) + 1} ${start.getFullYear()}`
    step = '1 month'
  } else {
    start = new Date(y + offset, 0, 1)
    end = new Date(y + offset + 1, 0, 1)
    label = String(start.getFullYear())
    step = '1 month'
  }
  return { from: ymd(start), toExclusive: ymd(end), label, step }
}

export function customRange(from: string, to: string): { cur: Range; prev: Range } {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const start = new Date(fy, fm - 1, fd)
  const endIncl = new Date(ty, tm - 1, td)
  const end = addDays(endIncl, 1)
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000))
  const step: Range['step'] = days <= 31 ? '1 day' : days <= 168 ? '7 days' : '1 month'
  const label =
    `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${endIncl.getDate()} ${MONTHS[endIncl.getMonth()]} ${endIncl.getFullYear()}`
  const prevStart = addDays(start, -days)
  return {
    cur: { from: ymd(start), toExclusive: ymd(end), label, step },
    prev: { from: ymd(prevStart), toExclusive: ymd(start), label: `${days} days before`, step },
  }
}

/** Bucket start dates for a range, matching the server's generate_series stepping. */
export function buckets(range: Range): string[] {
  const out: string[] = []
  const [y, m, d] = range.from.split('-').map(Number)
  let cur = new Date(y, m - 1, d)
  while (ymd(cur) < range.toExclusive) {
    out.push(ymd(cur))
    cur = range.step === '1 day' ? addDays(cur, 1) : range.step === '7 days' ? addDays(cur, 7) : addMonths(cur, 1)
  }
  return out
}
