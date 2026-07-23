import { eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { riotMatchSync } from "../database/schema";

export type RiotMatchSync = Omit<
	typeof riotMatchSync.$inferSelect,
	"updatedAt"
>;

const columns = {
	puuid: riotMatchSync.puuid,
	lastSyncedAt: riotMatchSync.lastSyncedAt,
	backfilled: riotMatchSync.backfilled,
	backfillSeconds: riotMatchSync.backfillSeconds,
	backfillAsOf: riotMatchSync.backfillAsOf,
};

export default class RiotMatchSyncRepository {
	constructor(private readonly db: Database) {}

	async get(puuid: string): Promise<RiotMatchSync | null> {
		const rows = await this.db
			.select(columns)
			.from(riotMatchSync)
			.where(eq(riotMatchSync.puuid, puuid));
		return rows[0] ?? null;
	}

	async setBackfill(
		puuid: string,
		backfillSeconds: number,
		lastSyncedAt: Date,
	): Promise<void> {
		await this.db
			.insert(riotMatchSync)
			.values({
				puuid,
				lastSyncedAt,
				backfilled: true,
				backfillSeconds,
				backfillAsOf: lastSyncedAt,
			})
			.onConflictDoUpdate({
				target: riotMatchSync.puuid,
				set: {
					lastSyncedAt,
					backfilled: true,
					backfillSeconds,
					backfillAsOf: lastSyncedAt,
					updatedAt: sql`NOW()`,
				},
			});
	}

	async touchSynced(puuid: string, lastSyncedAt: Date): Promise<void> {
		await this.db
			.insert(riotMatchSync)
			.values({ puuid, lastSyncedAt, backfilled: false, backfillSeconds: 0 })
			.onConflictDoUpdate({
				target: riotMatchSync.puuid,
				set: { lastSyncedAt, updatedAt: sql`NOW()` },
			});
	}
}
