// Standalone config for `@better-auth/cli generate` — avoids importing the app db
// (schema generation must run before src/db/auth-schema.ts exists).
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/node-postgres'
import { apiKey } from '@better-auth/api-key'

export const auth = betterAuth({
  database: drizzleAdapter(drizzle('postgres://x:x@localhost:5432/x'), { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      householdId: { type: 'string', required: false, input: false },
    },
  },
  plugins: [apiKey()],
})
