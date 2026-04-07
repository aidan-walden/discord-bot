type BanTableName = "gpt_user_bans" | "music_user_bans" | "music_guild_bans";
type BanColumnName = "user_id" | "guild_id";

export default class BanRepository {
	constructor(
		sql: typeof Bun.sql,
		tableName: "gpt_user_bans",
		columnName: "user_id",
	);
	constructor(
		sql: typeof Bun.sql,
		tableName: "music_user_bans",
		columnName: "user_id",
	);
	constructor(
		sql: typeof Bun.sql,
		tableName: "music_guild_bans",
		columnName: "guild_id",
	);
	constructor(
		private readonly sql: typeof Bun.sql,
		private readonly tableName: BanTableName,
		private readonly columnName: BanColumnName,
	) {}

	async has(id: string): Promise<boolean> {
		const results = await this.sql`
			SELECT 1
			FROM ${this.identifier(this.tableName)}
			WHERE ${this.identifier(this.columnName)} = ${id}
			LIMIT 1
		`;
		return results.length > 0;
	}

	async add(id: string): Promise<void> {
		await this.sql`
			INSERT INTO ${this.identifier(this.tableName)} (
				${this.identifier(this.columnName)}
			)
			VALUES (${id})
			ON CONFLICT (${this.identifier(this.columnName)}) DO NOTHING
		`;
	}

	async remove(id: string): Promise<void> {
		await this.sql`
			DELETE FROM ${this.identifier(this.tableName)}
			WHERE ${this.identifier(this.columnName)} = ${id}
		`;
	}

	async list(): Promise<string[]> {
		const results = await this.sql<Record<"value", string>[]>`
			SELECT ${this.identifier(this.columnName)} AS value
			FROM ${this.identifier(this.tableName)}
			ORDER BY ${this.identifier(this.columnName)} ASC
		`;
		return results.map((row) => row.value);
	}

	private identifier(identifier: BanTableName | BanColumnName) {
		return this.sql.unsafe(identifier);
	}
}
