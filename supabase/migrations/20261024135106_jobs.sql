CREATE TABLE "simulated_corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"kind" "corporate_action_kind" NOT NULL,
	"effective_date" date,
	"ratio_from" numeric,
	"ratio_to" numeric,
	"ex_date" date,
	"pay_date" date,
	"amount_per_share" numeric,
	"currency" "currency",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_shape" CHECK ("simulated_corporate_actions"."kind" <> 'split' or ("simulated_corporate_actions"."effective_date" is not null and "simulated_corporate_actions"."ratio_from" > 0 and "simulated_corporate_actions"."ratio_to" > 0)),
	CONSTRAINT "dividend_shape" CHECK ("simulated_corporate_actions"."kind" <> 'dividend' or ("simulated_corporate_actions"."ex_date" is not null and "simulated_corporate_actions"."pay_date" >= "simulated_corporate_actions"."ex_date"
        and "simulated_corporate_actions"."amount_per_share" > 0 and "simulated_corporate_actions"."currency" is not null))
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD COLUMN "external_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "simulated_corporate_actions" ADD CONSTRAINT "simulated_corporate_actions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "corporate_actions_external_id" ON "corporate_actions" USING btree ("external_id");