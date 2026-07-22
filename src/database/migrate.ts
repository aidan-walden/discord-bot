export async function migrateDatabase(sql: typeof Bun.sql): Promise<void> {
	await sql`
		CREATE TABLE IF NOT EXISTS gpt_user_bans (
			user_id TEXT PRIMARY KEY,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS music_user_bans (
			user_id TEXT PRIMARY KEY,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS music_guild_bans (
			guild_id TEXT PRIMARY KEY,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS user_balances (
			user_id TEXT PRIMARY KEY,
			balance_cents INTEGER NOT NULL DEFAULT 0,
			most_gained_cents INTEGER NOT NULL DEFAULT 0,
			most_lost_cents INTEGER NOT NULL DEFAULT 0,
			total_spent_cents INTEGER NOT NULL DEFAULT 0,
			total_gained_cents INTEGER NOT NULL DEFAULT 0,
			unbox_count INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS deafen_sessions (
			id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			user_id TEXT NOT NULL,
			guild_id TEXT NOT NULL,
			started_at TIMESTAMPTZ NOT NULL,
			ended_at TIMESTAMPTZ NOT NULL,
			duration_seconds INTEGER NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	await sql`
		CREATE INDEX IF NOT EXISTS idx_deafen_sessions_user_guild
			ON deafen_sessions (user_id, guild_id)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS deafen_summaries (
			user_id TEXT NOT NULL,
			guild_id TEXT NOT NULL,
			longest_deafen_seconds INTEGER NOT NULL DEFAULT 0,
			total_deafen_seconds INTEGER NOT NULL DEFAULT 0,
			session_count INTEGER NOT NULL DEFAULT 0,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (user_id, guild_id)
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS riot_rank_history (
			id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
			puuid TEXT NOT NULL,
			tier TEXT NOT NULL,
			rank TEXT NOT NULL,
			league_points INTEGER NOT NULL,
			wins INTEGER NOT NULL,
			losses INTEGER NOT NULL,
			detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	await sql`
		CREATE INDEX IF NOT EXISTS idx_riot_rank_history_puuid_detected
			ON riot_rank_history (puuid, detected_at DESC)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS riot_user_links (
			user_id TEXT PRIMARY KEY,
			puuid TEXT NOT NULL UNIQUE,
			platform TEXT NOT NULL,
			game_name TEXT NOT NULL,
			tag_line TEXT NOT NULL,
			linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS guild_settings (
			guild_id TEXT PRIMARY KEY,
			main_channel_id TEXT,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;
}
