import { inArray, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import {
	riotMatches,
	riotMatchParticipants,
	riotMatchSync,
	riotUserLinks,
} from "../database/schema";
import type { RiotMatch } from "../services/riot/types";

export default class RiotMatchRepository {
	constructor(private readonly db: Database) {}

	async existingMatchIds(matchIds: string[]): Promise<Set<string>> {
		if (matchIds.length === 0) {
			return new Set();
		}
		const rows = await this.db
			.select({ matchId: riotMatches.matchId })
			.from(riotMatches)
			.where(inArray(riotMatches.matchId, matchIds));
		return new Set(rows.map((row) => row.matchId));
	}

	async insertMatchWithParticipants(match: RiotMatch): Promise<void> {
		const matchId = match.metadata.matchId;

		await this.db.transaction(async (tx) => {
			await tx
				.insert(riotMatches)
				.values({
					matchId,
					queueId: match.info.queueId,
					gameDuration: match.info.gameDuration,
					gameCreation: new Date(match.info.gameCreation),
				})
				.onConflictDoNothing();

			for (const participant of match.info.participants) {
				const timePlayed =
					typeof participant.timePlayed === "number" &&
					participant.timePlayed > 0
						? participant.timePlayed
						: match.info.gameDuration;
				await tx
					.insert(riotMatchParticipants)
					.values({
						matchId,
						puuid: participant.puuid,
						timePlayed,
						championId: participant.championId,
						win: participant.win,
					})
					.onConflictDoNothing();
			}
		});
	}

	async sumTimePlayed(puuid: string): Promise<number> {
		const rows = await this.db.execute<{ total: string | number }>(
			sql`
				SELECT
				COALESCE(
					(SELECT ${riotMatchSync.backfillSeconds}
					 FROM ${riotMatchSync}
					 WHERE ${riotMatchSync.puuid} = ${puuid}),
					0
				)
				+ COALESCE(
					(SELECT SUM(${riotMatchParticipants.timePlayed})
					 FROM ${riotMatchParticipants}
					 INNER JOIN ${riotMatches}
						ON ${riotMatches.matchId} = ${riotMatchParticipants.matchId}
					 WHERE ${riotMatchParticipants.puuid} = ${puuid}
					   AND ${riotMatches.gameCreation} >= COALESCE(
						(SELECT ${riotMatchSync.backfillAsOf}
						 FROM ${riotMatchSync}
						 WHERE ${riotMatchSync.puuid} = ${puuid}),
						'-infinity'::timestamptz
					   )),
					0
				)
				AS total
			`,
		);
		return Number(rows[0]?.total ?? 0);
	}

	async sumTimePlayedForUser(userId: string): Promise<number> {
		const rows = await this.db.execute<{ total: string | number }>(
			sql`
				SELECT
				COALESCE((
					SELECT SUM(${riotMatchSync.backfillSeconds})
					FROM ${riotUserLinks}
					INNER JOIN ${riotMatchSync}
						ON ${riotMatchSync.puuid} = ${riotUserLinks.puuid}
					WHERE ${riotUserLinks.userId} = ${userId}
				), 0)
				+ COALESCE((
					SELECT SUM(${riotMatchParticipants.timePlayed})
					FROM ${riotUserLinks}
					INNER JOIN ${riotMatchParticipants}
						ON ${riotMatchParticipants.puuid} = ${riotUserLinks.puuid}
					INNER JOIN ${riotMatches}
						ON ${riotMatches.matchId} = ${riotMatchParticipants.matchId}
					LEFT JOIN ${riotMatchSync}
						ON ${riotMatchSync.puuid} = ${riotUserLinks.puuid}
					WHERE ${riotUserLinks.userId} = ${userId}
					  AND ${riotMatches.gameCreation} >= COALESCE(
						${riotMatchSync.backfillAsOf},
						'-infinity'::timestamptz
					  )
				), 0)
				AS total
			`,
		);
		return Number(rows[0]?.total ?? 0);
	}
}
