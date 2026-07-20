/// <reference lib="webworker" />
// SQLite (WASM) worker: owns the OPFS database; the main thread talks via tiny RPC (db.ts).
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

const SCHEMA = `
create table if not exists transactions(
  id text primary key, type text not null, amount real not null,
  original_amount real, original_currency text, fx_rate real,
  category_id text, category text, note text, occurred_on text not null,
  source text, user_id text, paid_by text, ord integer
);
create index if not exists tx_date_idx on transactions(occurred_on desc, ord);
create table if not exists categories(id text primary key, name text, kind text, archived integer default 0);
create table if not exists budgets(category_id text primary key, monthly_amount real not null);
create table if not exists docs(collection text, id text, data text, primary key(collection, id));
create table if not exists meta(key text primary key, value text);
create table if not exists outbox(seq integer primary key autoincrement, method text, path text, body text, created_at text);
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any
let persistent = true

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule()
  try {
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'hamara-hisaab' })
    db = new pool.OpfsSAHPoolDb('/finance.db')
  } catch (e) {
    // second tab or no OPFS support — run without persistence rather than breaking
    console.warn('[local] OPFS unavailable, falling back to in-memory database', e)
    db = new sqlite3.oo1.DB(':memory:')
    persistent = false
  }
  db.exec(SCHEMA)
})()

type Req =
  | { id: number; type: 'query'; sql: string; bind?: unknown[] }
  | { id: number; type: 'batch'; stmts: { sql: string; bind?: unknown[] }[] }
  | { id: number; type: 'status' }

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data
  try {
    await ready
    if (msg.type === 'query') {
      const rows: unknown[] = []
      db.exec({ sql: msg.sql, bind: msg.bind, rowMode: 'object', resultRows: rows })
      self.postMessage({ id: msg.id, rows })
    } else if (msg.type === 'batch') {
      db.transaction(() => {
        for (const s of msg.stmts) db.exec({ sql: s.sql, bind: s.bind })
      })
      self.postMessage({ id: msg.id, rows: [] })
    } else {
      self.postMessage({ id: msg.id, rows: [{ persistent }] })
    }
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err) })
  }
}
