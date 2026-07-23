import { eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { guildSettings } from "../database/schema";

export type GuildSettings = typeof guildSettings.$inferSelect;

export default class GuildSettingsRepository {
	constructor(private readonly db: Database) {}

	async get(guildId: string): Promise<GuildSettings | null> {
		const rows = await this.db
			.select()
			.from(guildSettings)
			.where(eq(guildSettings.guildId, guildId));
		return rows[0] ?? null;
	}

	async setMainChannel(
		guildId: string,
		channelId: string,
	): Promise<GuildSettings> {
		const rows = await this.db
			.insert(guildSettings)
			.values({ guildId, mainChannelId: channelId })
			.onConflictDoUpdate({
				target: guildSettings.guildId,
				set: { mainChannelId: channelId, updatedAt: sql`NOW()` },
			})
			.returning();
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to set guild main channel");
		}
		return row;
	}
}
