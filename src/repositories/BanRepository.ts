import type postgres from "postgres";

export default class BanRepository {
	constructor(
		private readonly sql: postgres.Sql,
		private readonly tableName:
			| "gpt_user_bans"
			| "music_user_bans"
			| "music_guild_bans",
		private readonly idColumn: "user_id" | "guild_id",
	) {}

	async has(id: string): Promise<boolean> {
		const results = await this.sql.unsafe(
			`SELECT 1 FROM ${this.tableName} WHERE ${this.idColumn} = $1 LIMIT 1`,
			[id],
		);
		return results.length > 0;
	}

	async add(id: string): Promise<void> {
		await this.sql.unsafe(
			`INSERT INTO ${this.tableName} (${this.idColumn}) VALUES ($1) ON CONFLICT (${this.idColumn}) DO NOTHING`,
			[id],
		);
	}

	async remove(id: string): Promise<void> {
		await this.sql.unsafe(
			`DELETE FROM ${this.tableName} WHERE ${this.idColumn} = $1`,
			[id],
		);
	}

	async list(): Promise<string[]> {
		const results = await this.sql.unsafe<Record<"value", string>[]>(
			`SELECT ${this.idColumn} AS value FROM ${this.tableName} ORDER BY ${this.idColumn} ASC`,
		);
		return results.map((row) => row.value);
	}
}
