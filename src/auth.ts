import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { apiKey } from '@better-auth/api-key'
import { db } from './db/client'
import * as schema from './db/schema'

const baseURL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

export const auth = betterAuth({
  baseURL,
  // localhost and 127.0.0.1 are the same machine — trust both spellings
  trustedOrigins: [baseURL, baseURL.replace('//localhost', '//127.0.0.1')],
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      householdId: { type: 'string', required: false, input: false },
    },
  },
  // ponytail: rate limiting off — these keys belong to the household's own agents
  plugins: [apiKey({ rateLimit: { enabled: false } })],
})
