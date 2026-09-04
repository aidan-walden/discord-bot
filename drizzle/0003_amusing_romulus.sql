CREATE TABLE "music_link_mappings" (
	"spotify_id" text NOT NULL,
	"apple_music_id" text NOT NULL,
	CONSTRAINT "music_link_mappings_pkey" PRIMARY KEY("spotify_id","apple_music_id")
);
--> statement-breakpoint
CREATE INDEX "idx_music_link_mappings_apple_music_id_spotify_id" ON "music_link_mappings" USING btree ("apple_music_id","spotify_id");