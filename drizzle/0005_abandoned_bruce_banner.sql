-- hand-edited: naive values are UTC wall-times (db container runs UTC) — cast explicitly so the
-- migration runner's TZ can't skew them (same reasoning as 0004)
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "households" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "households" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "zakat_settings" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "zakat_settings" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
-- backfill 'Asia/Karachi' as a FACT about pre-existing households, then drop it — timezone is
-- required at creation with no product default (a US self-hoster's households are never Karachi)
ALTER TABLE "households" ADD COLUMN "timezone" text NOT NULL DEFAULT 'Asia/Karachi';--> statement-breakpoint
ALTER TABLE "households" ALTER COLUMN "timezone" DROP DEFAULT;
