export interface GuildSettings {
	guildId: string;
	mainChannelId: string | null;
	updatedAt: Date;
}

interface GuildSettingsRow {
	guild_id: string;
	main_channel_id: string | null;
	updated_at: Date;
}

function mapRow(row: GuildSettingsRow): GuildSettings {
	return {
		guildId: row.guild_id,
		mainChannelId: row.main_channel_id,
		updatedAt: row.updated_at,
	};
}

export default class GuildSettingsRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	async get(guildId: string): Promise<GuildSettings | null> {
		const rows = await this.sql<GuildSettingsRow[]>`
			SELECT guild_id, main_channel_id, updated_at
			FROM guild_settings
			WHERE guild_id = ${guildId}
		`;
		const row = rows[0];
		return row ? mapRow(row) : null;
	}

	async setMainChannel(
		guildId: string,
		channelId: string,
	): Promise<GuildSettings> {
		const rows = await this.sql<GuildSettingsRow[]>`
			INSERT INTO guild_settings (guild_id, main_channel_id)
			VALUES (${guildId}, ${channelId})
			ON CONFLICT (guild_id) DO UPDATE SET
				main_channel_id = EXCLUDED.main_channel_id,
				updated_at = NOW()
			RETURNING guild_id, main_channel_id, updated_at
		`;
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to set guild main channel");
		}
		return mapRow(row);
	}
}
