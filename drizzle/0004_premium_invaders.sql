-- hand-edited: existing naive values are UTC wall-times (db container runs UTC);
-- without USING, the cast would read them in the migration runner's TZ (app runs PKT)
ALTER TABLE "audit_log" ALTER COLUMN "at" SET DATA TYPE timestamp with time zone USING "at" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "at" SET DEFAULT now();
