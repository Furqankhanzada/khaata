import cron from 'node-cron'
import { materializeDueRules } from '../services/recurring'
import { refreshPrices } from '../services/portfolio'
import { refreshFxRates } from '../services/fx'
import { purgeAuditLog } from '../services/audit'

export function startJobs() {
  const tz = { timezone: 'Asia/Karachi' }
  // hourly: each household's bills materialize when the due day arrives on ITS calendar
  cron.schedule('15 * * * *', () => void materializeDueRules().catch(logErr('recurring')), tz)
  cron.schedule('30 0 * * *', () => void refreshFxRates().catch(logErr('fx')), tz)
  cron.schedule('45 0 * * *', () => void purgeAuditLog().catch(logErr('audit-purge')), tz)
  // two attempts: PSX closes mid-afternoon, MUFAP NAV validity dates trickle in through the evening
  cron.schedule('30 18 * * *', () => void refreshPrices().catch(logErr('prices')), tz)
  cron.schedule('0 22 * * *', () => void refreshPrices().catch(logErr('prices')), tz)
  // catch up on missed recurring bills after downtime
  void materializeDueRules().catch(logErr('recurring-startup'))
}

const logErr = (label: string) => (e: unknown) => console.error(`[${label}]`, e)
