import { createAuthClient } from 'better-auth/react'
import { apiKeyClient } from '@better-auth/api-key/client'
import { localRead } from './local/selectors'
import { appBase } from './local/dates'
import { refresh } from './local/store'
import { isQueueable, mutate } from './local/outbox'

export const authClient = createAuthClient({ plugins: [apiKeyClient()] })

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T = unknown>(path: string, opts?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = opts ?? {}
  const method = (rest.method ?? 'GET').toUpperCase()

  // local-first: reads come from the on-device SQLite mirror once a snapshot exists
  if (method === 'GET') {
    const local = await localRead(path).catch(() => undefined)
    if (local !== undefined) return local as T
  }

  // local-first writes: commit locally, queue, sync in the background (works offline)
  if (isQueueable(method, path)) return (await mutate(method, path, json)) as T

  const res = await fetch(`/api/v1${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string })
    throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText)
  }
  const data = (await res.json()) as T
  if (method !== 'GET') void refresh() // keep the local mirror in step after online mutations
  return data
}

/** Today on the household's calendar as YYYY-MM-DD — entry defaults follow the household clock. */
export { todayApp as todayLocal } from './local/dates'

/** Display symbol for the household's base currency. */
export const symbolFor = (code: string): string =>
  ({ PKR: 'Rs', USD: '$', EUR: '\u20ac', GBP: '\u00a3', INR: '\u20b9' })[code] ?? code

export const baseSymbol = () => symbolFor(appBase())

export const rupees = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 })
export const fmt = (n: number | string | null | undefined) =>
  n == null ? '—' : `${baseSymbol()} ${rupees.format(Number(n))}`
