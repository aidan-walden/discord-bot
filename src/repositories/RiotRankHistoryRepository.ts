import { RANK_HISTORY_LIMIT } from "../services/riot/constants";
import type { RiotRank, RiotRankHistoryEntry } from "../services/riot/types";

interface RiotRankHistoryRow {
	puuid: string;
	tier: string;
	rank: string;
	league_points: number;
	wins: number;
	losses: number;
	detected_at: Date;
}

function ranksEqual(a: RiotRank, b: RiotRank): boolean {
	return (
		a.tier === b.tier &&
		a.rank === b.rank &&
		a.leaguePoints === b.leaguePoints &&
		a.wins === b.wins &&
		a.losses === b.losses
	);
}

function mapRow(row: RiotRankHistoryRow): RiotRankHistoryEntry {
	return {
		puuid: row.puuid,
		tier: row.tier,
		rank: row.rank,
		leaguePoints: row.league_points,
		wins: row.wins,
		losses: row.losses,
		detectedAt: row.detected_at,
	};
}

export default class RiotRankHistoryRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	async listByPuuid(puuid: string): Promise<RiotRankHistoryEntry[]> {
		const rows = await this.sql<RiotRankHistoryRow[]>`
			SELECT puuid, tier, rank, league_points, wins, losses, detected_at
			FROM riot_rank_history
			WHERE puuid = ${puuid}
			ORDER BY detected_at DESC
			LIMIT ${RANK_HISTORY_LIMIT}
		`;
		return rows.map(mapRow);
	}

	async recordIfChanged(
		puuid: string,
		rank: RiotRank,
		detectedAt: Date = new Date(),
	): Promise<RiotRankHistoryEntry | null> {
		const existing = await this.listByPuuid(puuid);
		const newest = existing[0];
		if (
			newest &&
			ranksEqual(
				{
					tier: newest.tier,
					rank: newest.rank,
					leaguePoints: newest.leaguePoints,
					wins: newest.wins,
					losses: newest.losses,
				},
				rank,
			)
		) {
			return null;
		}

		return this.sql.begin(async (tx) => {
			const inserted = await tx<RiotRankHistoryRow[]>`
				INSERT INTO riot_rank_history (
					puuid, tier, rank, league_points, wins, losses, detected_at
				)
				VALUES (
					${puuid},
					${rank.tier},
					${rank.rank},
					${rank.leaguePoints},
					${rank.wins},
					${rank.losses},
					${detectedAt}
				)
				RETURNING puuid, tier, rank, league_points, wins, losses, detected_at
			`;

			await tx`
				DELETE FROM riot_rank_history
				WHERE puuid = ${puuid}
					AND id NOT IN (
						SELECT id
						FROM riot_rank_history
						WHERE puuid = ${puuid}
						ORDER BY detected_at DESC
						LIMIT ${RANK_HISTORY_LIMIT}
					)
			`;

			const row = inserted[0];
			return row ? mapRow(row) : null;
		});
	}
}
