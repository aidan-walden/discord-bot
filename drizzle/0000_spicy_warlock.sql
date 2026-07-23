CREATE TABLE IF NOT EXISTS "deafen_sessions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deafen_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deafen_summaries" (
	"user_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"longest_deafen_seconds" integer DEFAULT 0 NOT NULL,
	"total_deafen_seconds" integer DEFAULT 0 NOT NULL,
	"session_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deafen_summaries_pkey" PRIMARY KEY("user_id","guild_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gpt_user_bans" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"main_channel_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "music_guild_bans" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "music_user_bans" (
	"user_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "riot_match_participants" (
	"match_id" text NOT NULL,
	"puuid" text NOT NULL,
	"time_played" integer NOT NULL,
	"champion_id" integer,
	"win" boolean,
	CONSTRAINT "riot_match_participants_pkey" PRIMARY KEY("puuid","match_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "riot_match_sync" (
	"puuid" text PRIMARY KEY NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"backfilled" boolean DEFAULT false NOT NULL,
	"backfill_seconds" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "riot_matches" (
	"match_id" text PRIMARY KEY NOT NULL,
	"queue_id" integer NOT NULL,
	"game_duration" integer NOT NULL,
	"game_creation" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "riot_rank_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "riot_rank_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"puuid" text NOT NULL,
	"tier" text NOT NULL,
	"rank" text NOT NULL,
	"league_points" integer NOT NULL,
	"wins" integer NOT NULL,
	"losses" integer NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "riot_user_links" (
	"puuid" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" text NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "secret_santa_assignments" (
	"draw_name" text NOT NULL,
	"giver_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	CONSTRAINT "secret_santa_assignments_pkey" PRIMARY KEY("draw_name","giver_id"),
	CONSTRAINT "secret_santa_assignments_draw_name_recipient_id_key" UNIQUE("draw_name","recipient_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "secret_santa_draws" (
	"name" text PRIMARY KEY NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"spend_limit_cents" integer,
	"drawn_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "secret_santa_exclusions" (
	"draw_name" text NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	CONSTRAINT "secret_santa_exclusions_pkey" PRIMARY KEY("draw_name","user_a","user_b"),
	CONSTRAINT "secret_santa_exclusions_check" CHECK ("secret_santa_exclusions"."user_a" < "secret_santa_exclusions"."user_b")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "secret_santa_participants" (
	"draw_name" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "secret_santa_participants_pkey" PRIMARY KEY("draw_name","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_balances" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"most_gained_cents" integer DEFAULT 0 NOT NULL,
	"most_lost_cents" integer DEFAULT 0 NOT NULL,
	"total_spent_cents" integer DEFAULT 0 NOT NULL,
	"total_gained_cents" integer DEFAULT 0 NOT NULL,
	"unbox_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "secret_santa_draws"
	ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'riot_user_links_pkey'
			AND conrelid = 'riot_user_links'::regclass
			AND pg_get_constraintdef(oid) LIKE '%user_id%'
	) THEN
		ALTER TABLE "riot_user_links" DROP CONSTRAINT "riot_user_links_pkey";
		ALTER TABLE "riot_user_links" DROP CONSTRAINT IF EXISTS "riot_user_links_puuid_key";
		ALTER TABLE "riot_user_links" ADD PRIMARY KEY ("puuid");
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'riot_match_participants_match_id_fkey'
			AND conrelid = 'riot_match_participants'::regclass
	) THEN
		ALTER TABLE "riot_match_participants"
			ADD CONSTRAINT "riot_match_participants_match_id_fkey"
			FOREIGN KEY ("match_id") REFERENCES "public"."riot_matches"("match_id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'secret_santa_assignments_draw_name_fkey'
			AND conrelid = 'secret_santa_assignments'::regclass
	) THEN
		ALTER TABLE "secret_santa_assignments"
			ADD CONSTRAINT "secret_santa_assignments_draw_name_fkey"
			FOREIGN KEY ("draw_name") REFERENCES "public"."secret_santa_draws"("name")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'secret_santa_exclusions_draw_name_fkey'
			AND conrelid = 'secret_santa_exclusions'::regclass
	) THEN
		ALTER TABLE "secret_santa_exclusions"
			ADD CONSTRAINT "secret_santa_exclusions_draw_name_fkey"
			FOREIGN KEY ("draw_name") REFERENCES "public"."secret_santa_draws"("name")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'secret_santa_participants_draw_name_fkey'
			AND conrelid = 'secret_santa_participants'::regclass
	) THEN
		ALTER TABLE "secret_santa_participants"
			ADD CONSTRAINT "secret_santa_participants_draw_name_fkey"
			FOREIGN KEY ("draw_name") REFERENCES "public"."secret_santa_draws"("name")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_deafen_sessions_user_guild" ON "deafen_sessions" USING btree ("user_id","guild_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_riot_match_participants_match_id" ON "riot_match_participants" USING btree ("match_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_riot_rank_history_puuid_detected" ON "riot_rank_history" USING btree ("puuid","detected_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_riot_user_links_user_id" ON "riot_user_links" USING btree ("user_id");
