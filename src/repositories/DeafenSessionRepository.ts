export type DeafenSession = {
	id: string;
	userId: string;
	guildId: string;
	startedAt: Date;
	endedAt: Date;
	durationSeconds: number;
};

export type DeafenSummary = {
	userId: string;
	guildId: string;
	longestDeafenSeconds: number;
	totalDeafenSeconds: number;
	sessionCount: number;
};

type DeafenSessionRow = {
	id: string;
	user_id: string;
	guild_id: string;
	started_at: Date;
	ended_at: Date;
	duration_seconds: number;
};

type DeafenSummaryRow = {
	user_id: string;
	guild_id: string;
	longest_deafen_seconds: number;
	total_deafen_seconds: number;
	session_count: number;
};

function mapSessionRow(row: DeafenSessionRow): DeafenSession {
	return {
		id: String(row.id),
		userId: row.user_id,
		guildId: row.guild_id,
		startedAt: new Date(row.started_at),
		endedAt: new Date(row.ended_at),
		durationSeconds: row.duration_seconds,
	};
}

function mapSummaryRow(row: DeafenSummaryRow): DeafenSummary {
	return {
		userId: row.user_id,
		guildId: row.guild_id,
		longestDeafenSeconds: row.longest_deafen_seconds,
		totalDeafenSeconds: row.total_deafen_seconds,
		sessionCount: row.session_count,
	};
}

export default class DeafenSessionRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	/**
	 * Persist a completed deafen stretch and fold it into the per-user, per-guild
	 * summary. Zero-length (or negative) stretches are treated as noise and skipped.
	 * Returns the updated summary, or null when nothing was persisted.
	 */
	async recordSession(
		userId: string,
		guildId: string,
		startedAt: Date,
		endedAt: Date,
	): Promise<DeafenSummary | null> {
		const durationSeconds = Math.max(
			0,
			Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
		);
		if (durationSeconds === 0) {
			return null;
		}

		return this.sql.begin(async (tx: typeof Bun.sql) => {
			await tx`
				INSERT INTO deafen_sessions (
					user_id,
					guild_id,
					started_at,
					ended_at,
					duration_seconds
				)
				VALUES (
					${userId},
					${guildId},
					${startedAt},
					${endedAt},
					${durationSeconds}
				)
			`;

			const rows = await tx<DeafenSummaryRow[]>`
				INSERT INTO deafen_summaries (
					user_id,
					guild_id,
					longest_deafen_seconds,
					total_deafen_seconds,
					session_count
				)
				VALUES (
					${userId},
					${guildId},
					${durationSeconds},
					${durationSeconds},
					1
				)
				ON CONFLICT (user_id, guild_id) DO UPDATE
				SET
					longest_deafen_seconds = GREATEST(
						deafen_summaries.longest_deafen_seconds,
						EXCLUDED.longest_deafen_seconds
					),
					total_deafen_seconds =
						deafen_summaries.total_deafen_seconds + EXCLUDED.total_deafen_seconds,
					session_count = deafen_summaries.session_count + 1,
					updated_at = NOW()
				RETURNING
					user_id,
					guild_id,
					longest_deafen_seconds,
					total_deafen_seconds,
					session_count
			`;

			const summary = rows[0];
			if (!summary) {
				throw new Error(
					`Failed to persist deafen summary for user ${userId} in guild ${guildId}.`,
				);
			}

			return mapSummaryRow(summary);
		});
	}

	async getSummary(
		userId: string,
		guildId: string,
	): Promise<DeafenSummary | null> {
		const rows = await this.sql<DeafenSummaryRow[]>`
			SELECT
				user_id,
				guild_id,
				longest_deafen_seconds,
				total_deafen_seconds,
				session_count
			FROM deafen_summaries
			WHERE user_id = ${userId} AND guild_id = ${guildId}
		`;

		const summary = rows[0];
		if (!summary) {
			return null;
		}

		return mapSummaryRow(summary);
	}

	async listSessions(
		userId: string,
		guildId: string,
		limit: number,
	): Promise<DeafenSession[]> {
		const rows = await this.sql<DeafenSessionRow[]>`
			SELECT
				id,
				user_id,
				guild_id,
				started_at,
				ended_at,
				duration_seconds
			FROM deafen_sessions
			WHERE user_id = ${userId} AND guild_id = ${guildId}
			ORDER BY started_at DESC
			LIMIT ${limit}
		`;

		return rows.map(mapSessionRow);
	}
}
