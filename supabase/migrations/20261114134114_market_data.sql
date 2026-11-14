CREATE TABLE "latest_quotes" (
	"instrument_id" uuid PRIMARY KEY NOT NULL,
	"price" numeric NOT NULL,
	"currency" "currency" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"delayed" boolean NOT NULL,
	CONSTRAINT "latest_quote_positive" CHECK ("latest_quotes"."price" > 0),
	CONSTRAINT "latest_quote_scale" CHECK (scale("latest_quotes"."price") <= 4)
);
--> statement-breakpoint
CREATE TABLE "price_fetch_state" (
	"key" text PRIMARY KEY NOT NULL,
	"attempted_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone,
	"covered_from" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "instruments" ALTER COLUMN "isin" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prices" ADD COLUMN "fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "instruments" ADD COLUMN "is_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "price_positive" CHECK ("prices"."price" > 0);--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "price_scale" CHECK (scale("prices"."price") <= 4);