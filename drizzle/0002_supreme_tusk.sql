CREATE TABLE "fx_rates" (
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"as_of" date NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	CONSTRAINT "fx_rates_base_quote_as_of_pk" PRIMARY KEY("base","quote","as_of")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "currency" text DEFAULT 'PKR' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "original_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "original_currency" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "fx_rate" numeric(18, 8);