# Khaata — ghar ka hisaab, ek jagah

Self-hosted household finance app for Pakistan: shared expense/income ledger, budgets,
PSX + mutual fund portfolio, loans (qarz), recurring bills and a zakat helper.
**API-first**: everything the web app can do, any AI agent can do too — via MCP or plain REST.

## Stack

One Node process (Hono) serving the REST API, an MCP endpoint and a React PWA, plus Postgres.
Two containers, one `docker compose up`.

## Quick start

```bash
cp .env.example .env      # set DB_PASSWORD, BETTER_AUTH_SECRET (openssl rand -base64 32), APP_URL
docker compose up -d --build
```

Open the app (default `http://localhost:3000`, change host port with `APP_PORT` in `.env`):

1. **Register** — creates your account.
2. **Create your household** — you get an invite code.
3. Your spouse registers and **joins with the invite code** → shared ledger, entries attributed per person.
4. **More → Agents & API keys** — create one API key per agent (one for you, one for your spouse's agent, etc.).

## Connecting agents

Every operation is exposed two ways; both authenticate with a per-user API key.
The key's owner is recorded as the payer on entries the agent makes.

### MCP (Claude, ChatGPT, and any MCP-capable agent)

Streamable-HTTP endpoint at `https://your-host/mcp` — 26 tools
(`add_transaction`, `get_budget_status`, `get_portfolio`, `get_monthly_report`, `add_loan`,
`get_zakat_summary`, …).

```bash
# Claude Code
claude mcp add finance --transport http https://your-host/mcp --header "x-api-key: YOUR_KEY"
```

`Authorization: Bearer YOUR_KEY` also works for clients that only support bearer auth.

### REST (Hermes, OpenClaw, scripts, anything)

Same operations at `/api/v1/*` with the `x-api-key` header — e.g. your WhatsApp Hermes agent logs an expense with:

```bash
curl -X POST https://your-host/api/v1/transactions \
  -H "x-api-key: YOUR_KEY" -H "content-type: application/json" \
  -d '{"type":"expense","amount":2500,"category":"Groceries","note":"Imtiaz weekly run"}'
```

Resources: `transactions`, `categories`, `budgets` (+ `/budgets/status`), `accounts`,
`portfolio`, `holdings`, `instruments`, `prices` (+ `/prices/refresh`), `loans` (+ `/:id/payments`),
`recurring`, `reports/monthly`, `zakat`, `household`. Amounts are PKR; dates are `YYYY-MM-DD` (Asia/Karachi).

## Price data (automatic)

A daily job (18:30 & 22:00 PKT) fetches:

- **PSX stocks** — closing price from `dps.psx.com.pk` (unofficial endpoint; fails soft).
- **Mutual funds** — daily NAVs scraped from the [MUFAP NAV table](https://www.mufap.com.pk/Industry/IndustryStatDaily?tab=3).
  When adding a fund, use the **exact fund name** as it appears there (e.g. `Al Meezan Mutual Fund`, `Mahaana Islamic Cash Fund`).
- **Other assets** (gold, property…) — manual valuation via *Set price*; manual prices always win over fetched ones.

Recurring bills materialize into the ledger on their due day (00:15 PKT, with catch-up after downtime).

## Development

```bash
docker compose up -d db          # Postgres on localhost:5433
npm install
npm run dev                      # API + SPA-serving on :3000 (PORT=3001 to change)
npm run dev:web                  # optional: Vite dev server with HMR, proxies /api → :3001
npm run db:generate              # regenerate SQL migration after editing src/db/schema.ts
npm run typecheck && npm run build
```

Auth tables (`src/db/auth-schema.ts`) are generated:
`npx @better-auth/cli generate --config scripts/auth-config.ts --output src/db/auth-schema.ts`.

Layout: `src/services/` holds all business logic; `src/routes.ts` (REST) and `src/mcp.ts` (MCP tools)
are thin wrappers over the same services, so the two surfaces can't drift.
