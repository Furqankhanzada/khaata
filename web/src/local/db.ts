// Main-thread handle to the SQLite worker. All values bind as-is; undefined → null.

type Pending = { resolve: (rows: unknown[]) => void; reject: (e: Error) => void }

const worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module' })
const pending = new Map<number, Pending>()
let seq = 0

worker.onmessage = (e: MessageEvent<{ id: number; rows?: unknown[]; error?: string }>) => {
  const p = pending.get(e.data.id)
  if (!p) return
  pending.delete(e.data.id)
  if (e.data.error) p.reject(new Error(e.data.error))
  else p.resolve(e.data.rows ?? [])
}

function post(msg: Record<string, unknown>): Promise<unknown[]> {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage({ ...msg, id })
  })
}

const clean = (bind?: unknown[]) => bind?.map((v) => (v === undefined ? null : v))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const query = <T = any>(sql: string, bind?: unknown[]) =>
  post({ type: 'query', sql, bind: clean(bind) }) as Promise<T[]>

export type Stmt = { sql: string; bind?: unknown[] }

/** Run statements atomically in one transaction. */
export const batch = (stmts: Stmt[]) =>
  post({ type: 'batch', stmts: stmts.map((s) => ({ sql: s.sql, bind: clean(s.bind) })) })
