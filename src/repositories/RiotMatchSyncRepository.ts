export interface RiotMatchSync {
	puuid: string;
	lastSyncedAt: Date;
	backfilled: boolean;
	backfillSeconds: number;
}

interface RiotMatchSyncRow {
	puuid: string;
	last_synced_at: Date;
	backfilled: boolean;
	backfill_seconds: string | number;
}

function mapRow(row: RiotMatchSyncRow): RiotMatchSync {
	return {
		puuid: row.puuid,
		lastSyncedAt: row.last_synced_at,
		backfilled: row.backfilled,
		backfillSeconds: Number(row.backfill_seconds),
	};
}

export default class RiotMatchSyncRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	async get(puuid: string): Promise<RiotMatchSync | null> {
		const rows = await this.sql<RiotMatchSyncRow[]>`
			SELECT puuid, last_synced_at, backfilled, backfill_seconds
			FROM riot_match_sync
			WHERE puuid = ${puuid}
		`;
		const row = rows[0];
		return row ? mapRow(row) : null;
	}

	async setBackfill(
		puuid: string,
		backfillSeconds: number,
		lastSyncedAt: Date,
	): Promise<void> {
		await this.sql`
			INSERT INTO riot_match_sync (
				puuid, last_synced_at, backfilled, backfill_seconds, updated_at
			)
			VALUES (
				${puuid},
				${lastSyncedAt},
				TRUE,
				${backfillSeconds},
				NOW()
			)
			ON CONFLICT (puuid) DO UPDATE SET
				last_synced_at = EXCLUDED.last_synced_at,
				backfilled = TRUE,
				backfill_seconds = EXCLUDED.backfill_seconds,
				updated_at = NOW()
		`;
	}

	async touchSynced(puuid: string, lastSyncedAt: Date): Promise<void> {
		await this.sql`
			INSERT INTO riot_match_sync (
				puuid, last_synced_at, backfilled, backfill_seconds, updated_at
			)
			VALUES (
				${puuid},
				${lastSyncedAt},
				FALSE,
				0,
				NOW()
			)
			ON CONFLICT (puuid) DO UPDATE SET
				last_synced_at = EXCLUDED.last_synced_at,
				updated_at = NOW()
		`;
	}
}
