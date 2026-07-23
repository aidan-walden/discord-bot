ALTER TABLE "riot_match_sync" ADD COLUMN "backfill_as_of" timestamp with time zone;
--> statement-breakpoint
-- Force wol.gg re-scrape; old Riot ID-count averages are wrong vs career totals.
UPDATE "riot_match_sync" SET "backfilled" = false, "backfill_seconds" = 0, "backfill_as_of" = null;