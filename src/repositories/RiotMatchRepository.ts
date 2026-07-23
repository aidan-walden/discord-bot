import type { RiotMatch } from "../services/riot/types";

export default class RiotMatchRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	async existingMatchIds(matchIds: string[]): Promise<Set<string>> {
		if (matchIds.length === 0) {
			return new Set();
		}
		const rows = await this.sql<{ match_id: string }[]>`
			SELECT match_id
			FROM riot_matches
			WHERE match_id IN ${this.sql(matchIds)}
		`;
		return new Set(rows.map((r) => r.match_id));
	}

	async insertMatchWithParticipants(match: RiotMatch): Promise<void> {
		const matchId = match.metadata.matchId;
		const gameCreation = new Date(match.info.gameCreation);

		await this.sql.begin(async (tx) => {
			await tx`
				INSERT INTO riot_matches (
					match_id, queue_id, game_duration, game_creation
				)
				VALUES (
					${matchId},
					${match.info.queueId},
					${match.info.gameDuration},
					${gameCreation}
				)
				ON CONFLICT (match_id) DO NOTHING
			`;

			for (const p of match.info.participants) {
				const timePlayed =
					typeof p.timePlayed === "number" && p.timePlayed > 0
						? p.timePlayed
						: match.info.gameDuration;
				await tx`
					INSERT INTO riot_match_participants (
						match_id, puuid, time_played, champion_id, win
					)
					VALUES (
						${matchId},
						${p.puuid},
						${timePlayed},
						${p.championId},
						${p.win}
					)
					ON CONFLICT (puuid, match_id) DO NOTHING
				`;
			}
		});
	}

	/** backfill_seconds + SUM(time_played) for one puuid. */
	async sumTimePlayed(puuid: string): Promise<number> {
		const rows = await this.sql<{ total: string | number }[]>`
			SELECT
				COALESCE(
					(SELECT backfill_seconds FROM riot_match_sync WHERE puuid = ${puuid}),
					0
				)
				+ COALESCE(
					(SELECT SUM(time_played) FROM riot_match_participants WHERE puuid = ${puuid}),
					0
				) AS total
		`;
		return Number(rows[0]?.total ?? 0);
	}

	/** Sum playtime across all linked accounts for a Discord user. */
	async sumTimePlayedForUser(userId: string): Promise<number> {
		const rows = await this.sql<{ total: string | number }[]>`
			SELECT
				COALESCE((
					SELECT SUM(s.backfill_seconds)
					FROM riot_user_links l
					INNER JOIN riot_match_sync s ON s.puuid = l.puuid
					WHERE l.user_id = ${userId}
				), 0)
				+ COALESCE((
					SELECT SUM(mp.time_played)
					FROM riot_user_links l
					INNER JOIN riot_match_participants mp ON mp.puuid = l.puuid
					WHERE l.user_id = ${userId}
				), 0) AS total
		`;
		return Number(rows[0]?.total ?? 0);
	}
}
