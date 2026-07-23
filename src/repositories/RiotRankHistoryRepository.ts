import { and, desc, eq, notInArray } from "drizzle-orm";
import type { Database } from "../database/client";
import { riotRankHistory } from "../database/schema";
import { RANK_HISTORY_LIMIT } from "../services/riot/constants";
import type { RiotRank, RiotRankHistoryEntry } from "../services/riot/types";

const columns = {
	puuid: riotRankHistory.puuid,
	tier: riotRankHistory.tier,
	rank: riotRankHistory.rank,
	leaguePoints: riotRankHistory.leaguePoints,
	wins: riotRankHistory.wins,
	losses: riotRankHistory.losses,
	detectedAt: riotRankHistory.detectedAt,
};

function ranksEqual(a: RiotRank, b: RiotRank): boolean {
	return (
		a.tier === b.tier &&
		a.rank === b.rank &&
		a.leaguePoints === b.leaguePoints &&
		a.wins === b.wins &&
		a.losses === b.losses
	);
}

export default class RiotRankHistoryRepository {
	constructor(private readonly db: Database) {}

	async listByPuuid(puuid: string): Promise<RiotRankHistoryEntry[]> {
		return this.db
			.select(columns)
			.from(riotRankHistory)
			.where(eq(riotRankHistory.puuid, puuid))
			.orderBy(desc(riotRankHistory.detectedAt))
			.limit(RANK_HISTORY_LIMIT);
	}

	async recordIfChanged(
		puuid: string,
		rank: RiotRank,
		detectedAt: Date = new Date(),
	): Promise<RiotRankHistoryEntry | null> {
		const newest = (await this.listByPuuid(puuid))[0];
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

		return this.db.transaction(async (tx) => {
			const inserted = await tx
				.insert(riotRankHistory)
				.values({ puuid, ...rank, detectedAt })
				.returning(columns);

			const retainedIds = tx
				.select({ id: riotRankHistory.id })
				.from(riotRankHistory)
				.where(eq(riotRankHistory.puuid, puuid))
				.orderBy(desc(riotRankHistory.detectedAt))
				.limit(RANK_HISTORY_LIMIT);
			await tx
				.delete(riotRankHistory)
				.where(
					and(
						eq(riotRankHistory.puuid, puuid),
						notInArray(riotRankHistory.id, retainedIds),
					),
				);

			return inserted[0] ?? null;
		});
	}
}
