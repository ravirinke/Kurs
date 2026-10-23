CREATE TYPE "public"."corporate_action_kind" AS ENUM('split', 'dividend');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('NOK', 'SEK', 'DKK', 'EUR', 'USD');--> statement-breakpoint
CREATE TYPE "public"."join_request_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('market');--> statement-breakpoint
CREATE TYPE "public"."price_kind" AS ENUM('close', 'intraday');--> statement-breakpoint
CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('deposit', 'buy', 'sell', 'fee', 'dividend', 'split');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('open', 'delayed', 'hidden');--> statement-breakpoint
CREATE TABLE "holdings" (
	"member_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric NOT NULL,
	"cost_basis" numeric NOT NULL,
	CONSTRAINT "holdings_member_id_instrument_id_pk" PRIMARY KEY("member_id","instrument_id"),
	CONSTRAINT "holding_quantity_positive" CHECK ("holdings"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"order_type" "order_type" DEFAULT 'market' NOT NULL,
	"side" "trade_side" NOT NULL,
	"quantity" numeric NOT NULL,
	"price" numeric NOT NULL,
	"price_currency" "currency" NOT NULL,
	"fx_rate" numeric NOT NULL,
	"gross_amount" numeric NOT NULL,
	"fee" numeric NOT NULL,
	"total_amount" numeric NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "quote_quantity_positive" CHECK ("quotes"."quantity" > 0),
	CONSTRAINT "quote_price_scale" CHECK (scale("quotes"."price") <= 4),
	CONSTRAINT "quote_fx_scale" CHECK (scale("quotes"."fx_rate") <= 6),
	CONSTRAINT "quote_gross_scale" CHECK (scale("quotes"."gross_amount") <= 2),
	CONSTRAINT "quote_fee_scale" CHECK (scale("quotes"."fee") <= 2),
	CONSTRAINT "quote_expires_after_creation" CHECK ("quotes"."expires_at" > "quotes"."created_at")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "transactions_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"league_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"amount" numeric NOT NULL,
	"instrument_id" uuid,
	"quantity" numeric,
	"price" numeric,
	"price_currency" "currency",
	"fx_rate" numeric,
	"gross_amount" numeric,
	"fee" numeric,
	"quote_id" uuid,
	"idempotency_key" text,
	"corporate_action_id" uuid,
	"amount_per_share" numeric,
	"dividend_currency" "currency",
	"ratio_from" numeric,
	"ratio_to" numeric,
	"quantity_before" numeric,
	"quantity_after" numeric,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "amount_scale" CHECK (scale("transactions"."amount") <= 2),
	CONSTRAINT "tx_price_scale" CHECK ("transactions"."price" is null or scale("transactions"."price") <= 4),
	CONSTRAINT "tx_fx_scale" CHECK ("transactions"."fx_rate" is null or scale("transactions"."fx_rate") <= 6),
	CONSTRAINT "tx_quantity_scale" CHECK ("transactions"."quantity" is null or scale("transactions"."quantity") <= 6),
	CONSTRAINT "trade_fields" CHECK ("transactions"."type" not in ('buy', 'sell') or (
        "transactions"."instrument_id" is not null and "transactions"."quantity" > 0 and "transactions"."price" is not null
        and "transactions"."price_currency" is not null and "transactions"."fx_rate" > 0
        and "transactions"."gross_amount" is not null and "transactions"."fee" >= 0
        and "transactions"."quote_id" is not null and "transactions"."idempotency_key" is not null)),
	CONSTRAINT "dividend_fields" CHECK ("transactions"."type" <> 'dividend' or (
        "transactions"."instrument_id" is not null and "transactions"."corporate_action_id" is not null
        and "transactions"."quantity" > 0 and "transactions"."amount_per_share" is not null
        and "transactions"."dividend_currency" is not null and "transactions"."fx_rate" > 0 and "transactions"."amount" >= 0)),
	CONSTRAINT "split_fields" CHECK ("transactions"."type" <> 'split' or (
        "transactions"."instrument_id" is not null and "transactions"."corporate_action_id" is not null
        and "transactions"."ratio_from" > 0 and "transactions"."ratio_to" > 0
        and "transactions"."quantity_before" is not null and "transactions"."quantity_after" is not null
        and "transactions"."amount" >= 0)),
	CONSTRAINT "deposit_positive" CHECK ("transactions"."type" <> 'deposit' or "transactions"."amount" > 0),
	CONSTRAINT "fee_negative" CHECK ("transactions"."type" <> 'fee' or "transactions"."amount" < 0)
);
--> statement-breakpoint
CREATE TABLE "league_allowed_exchanges" (
	"league_id" uuid NOT NULL,
	"exchange_id" text NOT NULL,
	CONSTRAINT "league_allowed_exchanges_league_id_exchange_id_pk" PRIMARY KEY("league_id","exchange_id")
);
--> statement-breakpoint
CREATE TABLE "league_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"status" "join_request_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	CONSTRAINT "decision_consistent" CHECK (("league_join_requests"."status" = 'pending') = ("league_join_requests"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"cash_balance" numeric NOT NULL,
	"last_trade_at" timestamp with time zone,
	"final_rank" integer,
	"final_value" numeric,
	"final_return" numeric,
	"is_winner" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cash_not_negative" CHECK ("league_members"."cash_balance" >= 0),
	CONSTRAINT "cash_scale" CHECK (scale("league_members"."cash_balance") <= 2),
	CONSTRAINT "final_value_scale" CHECK ("league_members"."final_value" is null or scale("league_members"."final_value") <= 2)
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"currency" "currency" NOT NULL,
	"start_amount" numeric NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"visibility" "visibility" DEFAULT 'delayed' NOT NULL,
	"fee_rate" numeric NOT NULL,
	"fee_minimum" numeric NOT NULL,
	"max_position_share" numeric,
	"invite_code" text NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leagues_invite_code_unique" UNIQUE("invite_code"),
	CONSTRAINT "ends_after_start" CHECK ("leagues"."ends_at" > "leagues"."starts_at"),
	CONSTRAINT "start_amount_positive" CHECK ("leagues"."start_amount" > 0),
	CONSTRAINT "start_amount_scale" CHECK (scale("leagues"."start_amount") <= 2),
	CONSTRAINT "fee_rate_range" CHECK ("leagues"."fee_rate" >= 0 and "leagues"."fee_rate" <= 0.05),
	CONSTRAINT "fee_minimum_valid" CHECK ("leagues"."fee_minimum" >= 0 and scale("leagues"."fee_minimum") <= 2),
	CONSTRAINT "max_position_share_range" CHECK ("leagues"."max_position_share" is null or ("leagues"."max_position_share" > 0 and "leagues"."max_position_share" <= 1)),
	CONSTRAINT "name_length" CHECK (char_length("leagues"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "corporate_actions" (
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
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_shape" CHECK ("corporate_actions"."kind" <> 'split' or ("corporate_actions"."effective_date" is not null and "corporate_actions"."ratio_from" > 0 and "corporate_actions"."ratio_to" > 0)),
	CONSTRAINT "dividend_shape" CHECK ("corporate_actions"."kind" <> 'dividend' or ("corporate_actions"."ex_date" is not null and "corporate_actions"."pay_date" >= "corporate_actions"."ex_date"
        and "corporate_actions"."amount_per_share" > 0 and "corporate_actions"."currency" is not null))
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"from_currency" "currency" NOT NULL,
	"to_currency" "currency" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"rate" numeric NOT NULL,
	CONSTRAINT "fx_rates_from_currency_to_currency_at_pk" PRIMARY KEY("from_currency","to_currency","at"),
	CONSTRAINT "fx_rate_positive" CHECK ("fx_rates"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"league_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"value" numeric NOT NULL,
	"cash" numeric NOT NULL,
	"return_fraction" numeric NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	CONSTRAINT "portfolio_snapshots_member_id_date_pk" PRIMARY KEY("member_id","date"),
	CONSTRAINT "snapshot_value_scale" CHECK (scale("portfolio_snapshots"."value") <= 2)
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"instrument_id" uuid NOT NULL,
	"kind" "price_kind" NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"price" numeric NOT NULL,
	"currency" "currency" NOT NULL,
	CONSTRAINT "prices_instrument_id_kind_at_pk" PRIMARY KEY("instrument_id","kind","at")
);
--> statement-breakpoint
CREATE TABLE "exchange_holidays" (
	"exchange_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"closes_early_at" time,
	CONSTRAINT "exchange_holidays_exchange_id_date_pk" PRIMARY KEY("exchange_id","date")
);
--> statement-breakpoint
CREATE TABLE "exchange_trading_hours" (
	"exchange_id" text NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	CONSTRAINT "exchange_trading_hours_exchange_id_weekday_pk" PRIMARY KEY("exchange_id","weekday"),
	CONSTRAINT "weekday_range" CHECK ("exchange_trading_hours"."weekday" between 1 and 7),
	CONSTRAINT "opens_before_close" CHECK ("exchange_trading_hours"."opens_at" < "exchange_trading_hours"."closes_at")
);
--> statement-breakpoint
CREATE TABLE "exchanges" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"time_zone" text NOT NULL,
	"currency" "currency" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"isin" text NOT NULL,
	"name" text NOT NULL,
	"exchange_id" text NOT NULL,
	"currency" "currency" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "instruments_isin_unique" UNIQUE("isin"),
	CONSTRAINT "instruments_exchange_ticker" UNIQUE("exchange_id","ticker")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_corporate_action_id_corporate_actions_id_fk" FOREIGN KEY ("corporate_action_id") REFERENCES "public"."corporate_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_allowed_exchanges" ADD CONSTRAINT "league_allowed_exchanges_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_allowed_exchanges" ADD CONSTRAINT "league_allowed_exchanges_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_join_requests" ADD CONSTRAINT "league_join_requests_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_join_requests" ADD CONSTRAINT "league_join_requests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_join_requests" ADD CONSTRAINT "league_join_requests_decided_by_profiles_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_member_id_league_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."league_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_holidays" ADD CONSTRAINT "exchange_holidays_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_trading_hours" ADD CONSTRAINT "exchange_trading_hours_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotes_member" ON "quotes" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "transactions_member_order" ON "transactions" USING btree ("member_id","occurred_at","sequence");--> statement-breakpoint
CREATE INDEX "transactions_league" ON "transactions" USING btree ("league_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_idempotency" ON "transactions" USING btree ("member_id","idempotency_key") WHERE "transactions"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_corporate_action" ON "transactions" USING btree ("member_id","corporate_action_id") WHERE "transactions"."corporate_action_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "league_join_requests_one_pending" ON "league_join_requests" USING btree ("league_id","user_id") WHERE "league_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "league_members_league_user" ON "league_members" USING btree ("league_id","user_id");--> statement-breakpoint
CREATE INDEX "league_members_user" ON "league_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "corporate_actions_instrument" ON "corporate_actions" USING btree ("instrument_id");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_league_date" ON "portfolio_snapshots" USING btree ("league_id","date");