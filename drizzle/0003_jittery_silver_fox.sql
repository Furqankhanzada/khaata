CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"household_id" text,
	"user_id" text,
	"channel" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");