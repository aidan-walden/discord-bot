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
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;
}
