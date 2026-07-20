# Hamara Hisaab — working rules

## Tests accompany every change (standing policy)

- **Every behavior change lands with tests in the same commit.** Backend/API changes extend or adjust `test/integration/*.test.ts` (API-level, real Postgres, in-process app); UI-flow changes extend or adjust `e2e/*.spec.ts` (Playwright). Changed behavior means changed assertions — never delete a failing test to make a change pass without understanding why.
- Run `npm test` before every commit; also `npm run test:e2e` when the web UI changed.
- **New interactive UI controls need interaction-level assertions, not just end-state.** `selectOption()`/`fill()` bypass the real interaction, so a flow can pass while the control is broken for humans (a native select popup closing instantly was missed this way). Assert proxy signals too: focus retention after click, `aria-expanded`, visible options.
- Parser/fetcher logic (PSX, MUFAP, FX) is tested with stubbed `fetch` fixtures in `test/unit/` — tests never hit the network.

## Architecture rules

- **Services-first**: business logic lives in `src/services/*`; `src/routes.ts` (REST) and `src/mcp.ts` (MCP tools) are thin wrappers over the same services. Every user-facing capability gets an MCP tool — agents are first-class clients.
- **Local-first web client**: the browser holds a SQLite (WASM/OPFS) mirror in `web/src/local/*`, fed by `GET /snapshot` (per-user filtered, ETag). `api()` serves GETs from local SQL and routes domain mutations through an outbox (optimistic apply → ordered replay with client-uuid idempotency). Server stays the source of truth; MCP/audit are unaffected. When changing a server read shape, update the matching selector in `web/src/local/selectors.ts`; new creatable inputs need the optional client `id` + onConflictDoNothing pattern.
- **Wealth privacy**: any query touching holdings/accounts/loans must include the visibility rule (`visibility = 'shared' OR user_id = ctx.userId`); invisible rows 404 on writes.
- **Money**: all aggregation is PKR. Foreign transactions convert once at entry (locked rate, original preserved); accounts/stocks convert at the latest `fx_rates` rate on read.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate`; hand-append backfills to the generated SQL when needed. Migrations run at app boot.

## Commands

- Dev: `docker compose up -d db` then `npm run dev` — runs on :3001 against the **`finance_dev`** database (`.env` sets `DATABASE_URL`/`PORT`; never point dev at the prod `finance` db). Refresh dev data from prod: `docker exec financial-manager-db-1 sh -c 'dropdb -U finance --if-exists finance_dev && createdb -U finance finance_dev && pg_dump -U finance finance | psql -q -U finance -d finance_dev'`.
- Checks: `npm run typecheck` · `npm test` · `npm run test:e2e` · `npm run build`
- Deploy: `docker compose up -d --build app` — then **verify the served bundle hash changed** (`curl -s localhost:9700/ | grep -oE 'assets/index-[^"]+\.js'`); a stale image once passed the health check silently.

## Test infrastructure

- Integration: vitest; `test/helpers.ts` provides `getApp/req/json/makeUser/mcp`. The test DB `finance_test` is auto-created/migrated off `DATABASE_URL` (defaults to the dev container on :5433). Suites isolate through fresh users/households per test — no truncation needed.
- E2E: `playwright.config.ts` boots the real server on :3010 against a fresh `finance_e2e` (`e2e/reset-db.mjs`). Use the `type()` helper from `e2e/util.ts` for inputs — Playwright's `fill()` doesn't reach React state on some controlled inputs.
