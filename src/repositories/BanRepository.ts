export default class BanRepository {
	constructor(
		private readonly sql: typeof Bun.sql,
		private readonly tableName:
			| "gpt_user_bans"
			| "music_user_bans"
			| "music_guild_bans",
	) {}

	async has(id: string): Promise<boolean> {
		const results = await this.selectOne(id);
		return results.length > 0;
	}

	async add(id: string): Promise<void> {
		switch (this.tableName) {
			case "gpt_user_bans":
				await this
					.sql`INSERT INTO gpt_user_bans (user_id) VALUES (${id}) ON CONFLICT (user_id) DO NOTHING`;
				return;
			case "music_user_bans":
				await this
					.sql`INSERT INTO music_user_bans (user_id) VALUES (${id}) ON CONFLICT (user_id) DO NOTHING`;
				return;
			case "music_guild_bans":
				await this
					.sql`INSERT INTO music_guild_bans (guild_id) VALUES (${id}) ON CONFLICT (guild_id) DO NOTHING`;
				return;
		}
	}

	async remove(id: string): Promise<void> {
		switch (this.tableName) {
			case "gpt_user_bans":
				await this.sql`DELETE FROM gpt_user_bans WHERE user_id = ${id}`;
				return;
			case "music_user_bans":
				await this.sql`DELETE FROM music_user_bans WHERE user_id = ${id}`;
				return;
			case "music_guild_bans":
				await this.sql`DELETE FROM music_guild_bans WHERE guild_id = ${id}`;
				return;
		}
	}

	async list(): Promise<string[]> {
		const results = await this.selectAll();
		return results.map((row) => row.value);
	}

	private selectOne(id: string) {
		switch (this.tableName) {
			case "gpt_user_bans":
				return this
					.sql`SELECT 1 FROM gpt_user_bans WHERE user_id = ${id} LIMIT 1`;
			case "music_user_bans":
				return this
					.sql`SELECT 1 FROM music_user_bans WHERE user_id = ${id} LIMIT 1`;
			case "music_guild_bans":
				return this
					.sql`SELECT 1 FROM music_guild_bans WHERE guild_id = ${id} LIMIT 1`;
		}
	}

	private selectAll() {
		switch (this.tableName) {
			case "gpt_user_bans":
				return this.sql<
					Record<"value", string>[]
				>`SELECT user_id AS value FROM gpt_user_bans ORDER BY user_id ASC`;
			case "music_user_bans":
				return this.sql<
					Record<"value", string>[]
				>`SELECT user_id AS value FROM music_user_bans ORDER BY user_id ASC`;
			case "music_guild_bans":
				return this.sql<
					Record<"value", string>[]
				>`SELECT guild_id AS value FROM music_guild_bans ORDER BY guild_id ASC`;
		}
	}
}
