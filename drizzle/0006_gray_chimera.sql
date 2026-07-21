-- backfill 'PKR' as a FACT about pre-existing households, then drop it — base currency is
-- required at creation with no product default, and immutable afterwards
ALTER TABLE "households" ADD COLUMN "base_currency" text NOT NULL DEFAULT 'PKR';--> statement-breakpoint
ALTER TABLE "households" ALTER COLUMN "base_currency" DROP DEFAULT;--> statement-breakpoint
-- prices keep a real default: PSX/MUFAP feeds quote in PKR (data-source fact)
ALTER TABLE "prices" ADD COLUMN "currency" text DEFAULT 'PKR' NOT NULL;
