ALTER TABLE "league_members" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "name_confirmed" boolean DEFAULT false NOT NULL;