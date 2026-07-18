import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://finance:finance@localhost:5433/finance',
})

export const db = drizzle(pool, { schema })
