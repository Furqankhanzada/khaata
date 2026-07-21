import '../src/env'
import crypto from 'node:crypto'
import type { Hono } from 'hono'

// Env must be set before any src/ module loads (db client + auth read it at import time).
const devUrl = process.env.DATABASE_URL ?? 'postgres://finance:finance@localhost:5433/finance'
export const TEST_DB_URL = devUrl.replace(/\/[^/]+$/, '/finance_test')
process.env.DATABASE_URL = TEST_DB_URL
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret'
process.env.BETTER_AUTH_URL = 'http://localhost:3000'
delete process.env.DISABLE_SIGNUPS // .env may block signups in prod; tests create users freely
export const ORIGIN = 'http://localhost:3000'

let ready: Promise<Hono> | null = null

/** Create + migrate the test database once, then return the in-process app. */
export function getApp(): Promise<Hono> {
  ready ??= (async () => {
    const pg = (await import('pg')).default
    const admin = new pg.Client({ connectionString: devUrl })
    await admin.connect()
    const dbName = TEST_DB_URL.split('/').pop()!
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName])
    if (!rowCount) await admin.query(`create database ${dbName}`)
    await admin.end()

    const { migrate } = await import('drizzle-orm/node-postgres/migrator')
    const { db } = await import('../src/db/client')
    await migrate(db, { migrationsFolder: './drizzle' })
    const { buildApp } = await import('../src/app')
    return buildApp()
  })()
  return ready
}

type ReqInit = { method?: string; json?: unknown; cookie?: string; key?: string }

export async function req(path: string, init: ReqInit = {}) {
  const app = await getApp()
  const headers: Record<string, string> = { Origin: ORIGIN }
  if (init.json !== undefined) headers['content-type'] = 'application/json'
  if (init.cookie) headers.cookie = init.cookie
  if (init.key) headers['x-api-key'] = init.key
  const res = await app.request(path, {
    method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
  })
  return res
}

export async function json<T = any>(path: string, init: ReqInit = {}): Promise<T> {
  const res = await req(path, init)
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export type TestUser = { email: string; cookie: string; key: string; userId: string }

function cookieFrom(res: Response): string {
  const set = res.headers.get('set-cookie') ?? ''
  const m = set.match(/([^,;\s]*better-auth[^=]*=[^;]+)/)
  if (!m) throw new Error(`no session cookie in: ${set}`)
  return m[1]
}

/** Register a user; creates a household (or joins via inviteCode) and mints an API key. */
export async function makeUser(opts: { inviteCode?: string; name?: string } = {}): Promise<TestUser> {
  const email = `t-${crypto.randomUUID().slice(0, 8)}@test.local`
  const res = await req('/api/auth/sign-up/email', {
    json: { email, password: 'password-123', name: opts.name ?? 'Tester' },
  })
  if (!res.ok) throw new Error(`sign-up failed: ${await res.text()}`)
  const cookie = cookieFrom(res)
  const { user } = (await res.json()) as { user: { id: string } }

  await json('/api/v1/household', {
    cookie,
    json: opts.inviteCode ? { invite_code: opts.inviteCode } : { name: `home-${email}`, timezone: 'Asia/Karachi' },
  })
  const keyRes = await json<{ key: string }>('/api/auth/api-key/create', { cookie, json: { name: 'test' } })
  return { email, cookie, key: keyRes.key, userId: user.id }
}

export async function inviteCodeOf(u: TestUser): Promise<string> {
  const h = await json<{ inviteCode: string }>('/api/v1/household', { cookie: u.cookie })
  return h.inviteCode
}

/** JSON-RPC call against /mcp; parses the SSE frame. */
export async function mcp(key: string | null, method: string, params?: unknown, id = 1) {
  const app = await getApp()
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(key ? { 'x-api-key': key } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) }),
  })
  if (!res.ok) return { status: res.status, body: await res.json().catch(() => null) }
  const text = await res.text()
  const data = text.split('\n').find((l) => l.startsWith('data: '))
  return { status: res.status, body: data ? JSON.parse(data.slice(6)) : null }
}

// Karachi, not runner-local: the server stamps PKT dates, and CI runs in UTC —
// between 19:00–24:00 UTC the two disagree and runner-local dates flake.
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
export const thisMonth = () => today().slice(0, 7)
