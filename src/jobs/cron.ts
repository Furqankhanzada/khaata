import cron from 'node-cron'
import { materializeDueRules } from '../services/recurring'
import { refreshPrices } from '../services/portfolio'

export function startJobs() {
  const tz = { timezone: 'Asia/Karachi' }
  cron.schedule('15 0 * * *', () => void materializeDueRules().catch(logErr('recurring')), tz)
  // two attempts: PSX closes mid-afternoon, MUFAP NAV validity dates trickle in through the evening
  cron.schedule('30 18 * * *', () => void refreshPrices().catch(logErr('prices')), tz)
  cron.schedule('0 22 * * *', () => void refreshPrices().catch(logErr('prices')), tz)
  // catch up on missed recurring bills after downtime
  void materializeDueRules().catch(logErr('recurring-startup'))
}

const logErr = (label: string) => (e: unknown) => console.error(`[${label}]`, e)
