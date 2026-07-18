import './env'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { ZodError } from 'zod'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './db/client'
import { auth } from './auth'
import { api } from './routes'
import { mcpApp } from './mcp'
import { startJobs } from './jobs/cron'

await migrate(db, { migrationsFolder: './drizzle' })

const app = new Hono()

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: 'validation', issues: err.issues }, 400)
  console.error(err)
  return c.json({ error: (err as Error).message ?? 'internal error' }, 500)
})

app.get('/healthz', (c) => c.json({ ok: true }))
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
app.route('/api/v1', api)
app.route('/mcp', mcpApp)

// built SPA (dist/public) with SPA fallback
app.use('*', serveStatic({ root: './dist/public' }))
app.get('*', serveStatic({ path: './dist/public/index.html' }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, (info) => console.log(`financial-manager listening on :${info.port}`))
startJobs()
