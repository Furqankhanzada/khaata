// Load .env in dev; in Docker the env comes from compose and the file doesn't exist.
try {
  process.loadEnvFile()
} catch {
  /* no .env file — fine */
}
