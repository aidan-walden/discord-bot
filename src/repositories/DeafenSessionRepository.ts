import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { deafenSessions, deafenSummaries } from "../database/schema";

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

const summaryColumns = {
	userId: deafenSummaries.userId,
	guildId: deafenSummaries.guildId,
	longestDeafenSeconds: deafenSummaries.longestDeafenSeconds,
	totalDeafenSeconds: deafenSummaries.totalDeafenSeconds,
	sessionCount: deafenSummaries.sessionCount,
};

export default class DeafenSessionRepository {
	constructor(private readonly db: Database) {}

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

		return this.db.transaction(async (tx) => {
			await tx.insert(deafenSessions).values({
				userId,
				guildId,
				startedAt,
				endedAt,
				durationSeconds,
			});

			const rows = await tx
				.insert(deafenSummaries)
				.values({
					userId,
					guildId,
					longestDeafenSeconds: durationSeconds,
					totalDeafenSeconds: durationSeconds,
					sessionCount: 1,
				})
				.onConflictDoUpdate({
					target: [deafenSummaries.userId, deafenSummaries.guildId],
					set: {
						longestDeafenSeconds: sql`GREATEST(${deafenSummaries.longestDeafenSeconds}, EXCLUDED.longest_deafen_seconds)`,
						totalDeafenSeconds: sql`${deafenSummaries.totalDeafenSeconds} + EXCLUDED.total_deafen_seconds`,
						sessionCount: sql`${deafenSummaries.sessionCount} + 1`,
						updatedAt: sql`NOW()`,
					},
				})
				.returning(summaryColumns);

			const summary = rows[0];
			if (!summary) {
				throw new Error(
					`Failed to persist deafen summary for user ${userId} in guild ${guildId}.`,
				);
			}
			return summary;
		});
	}

	async getSummary(
		userId: string,
		guildId: string,
	): Promise<DeafenSummary | null> {
		const rows = await this.db
			.select(summaryColumns)
			.from(deafenSummaries)
			.where(
				and(
					eq(deafenSummaries.userId, userId),
					eq(deafenSummaries.guildId, guildId),
				),
			);
		return rows[0] ?? null;
	}

	async listSessions(
		userId: string,
		guildId: string,
		limit: number,
	): Promise<DeafenSession[]> {
		const rows = await this.db
			.select({
				id: deafenSessions.id,
				userId: deafenSessions.userId,
				guildId: deafenSessions.guildId,
				startedAt: deafenSessions.startedAt,
				endedAt: deafenSessions.endedAt,
				durationSeconds: deafenSessions.durationSeconds,
			})
			.from(deafenSessions)
			.where(
				and(
					eq(deafenSessions.userId, userId),
					eq(deafenSessions.guildId, guildId),
				),
			)
			.orderBy(desc(deafenSessions.startedAt))
			.limit(limit);

		return rows.map((row) => ({ ...row, id: String(row.id) }));
	}
}
