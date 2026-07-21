import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { logger } from 'hono/logger'
import { ZodError } from 'zod'
import { auth } from './auth'
import { api } from './routes'
import { mcpApp } from './mcp'

/** The full HTTP app, side-effect free (no migrate/listen/cron) — tests exercise it in-process. */
export function buildApp() {
  const app = new Hono()

  app.use('/api/*', logger())
  app.use('/mcp', logger())

  app.onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: 'validation', issues: err.issues }, 400)
    // services signal caller errors (e.g. an unknown tag) this way — the message is the guidance
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error(err)
    return c.json({ error: (err as Error).message ?? 'internal error' }, 500)
  })

  app.get('/healthz', (c) => c.json({ ok: true }))
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  app.route('/api/v1', api)
  app.route('/mcp', mcpApp)

  // built SPA (dist/public) with SPA fallback
  // hashed assets cache forever; everything else (index.html, sw.js, manifest) revalidates
  // on every load so new deploys reach devices on their next open
  app.use('*', async (c, next) => {
    await next()
    c.header('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
  })
  app.use('*', serveStatic({ root: './dist/public' }))
  app.get('*', serveStatic({ path: './dist/public/index.html' }))

  return app
}
