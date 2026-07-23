import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { riotUserLinks } from "../database/schema";
import type { RiotPlatform } from "../services/riot/constants";

export interface RiotUserLink {
	userId: string;
	puuid: string;
	platform: RiotPlatform;
	gameName: string;
	tagLine: string;
	linkedAt: Date;
}

function mapRow(row: typeof riotUserLinks.$inferSelect): RiotUserLink {
	return { ...row, platform: row.platform as RiotPlatform };
}

export default class RiotUserLinkRepository {
	constructor(private readonly db: Database) {}

	async getPrimaryByUserId(userId: string): Promise<RiotUserLink | null> {
		const rows = await this.db
			.select()
			.from(riotUserLinks)
			.where(eq(riotUserLinks.userId, userId))
			.orderBy(desc(riotUserLinks.linkedAt))
			.limit(1);
		return rows[0] ? mapRow(rows[0]) : null;
	}

	/** @deprecated use getPrimaryByUserId — kept as alias */
	async getByUserId(userId: string): Promise<RiotUserLink | null> {
		return this.getPrimaryByUserId(userId);
	}

	async listByUserId(userId: string): Promise<RiotUserLink[]> {
		const rows = await this.db
			.select()
			.from(riotUserLinks)
			.where(eq(riotUserLinks.userId, userId))
			.orderBy(desc(riotUserLinks.linkedAt));
		return rows.map(mapRow);
	}

	async listAll(): Promise<RiotUserLink[]> {
		return (await this.db.select().from(riotUserLinks)).map(mapRow);
	}

	async upsert(link: {
		userId: string;
		puuid: string;
		platform: RiotPlatform;
		gameName: string;
		tagLine: string;
	}): Promise<RiotUserLink> {
		const rows = await this.db
			.insert(riotUserLinks)
			.values(link)
			.onConflictDoUpdate({
				target: riotUserLinks.puuid,
				set: { ...link, linkedAt: sql`NOW()` },
			})
			.returning();
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to upsert riot user link");
		}
		return mapRow(row);
	}
}
