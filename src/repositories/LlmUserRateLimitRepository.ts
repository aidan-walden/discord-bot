import { eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { llmUserRateLimits } from "../database/schema";

export default class LlmUserRateLimitRepository {
	constructor(private readonly db: Database) {}

	async get(userId: string): Promise<number | null> {
		const rows = await this.db
			.select({ requestsPerHour: llmUserRateLimits.requestsPerHour })
			.from(llmUserRateLimits)
			.where(eq(llmUserRateLimits.userId, userId))
			.limit(1);
		return rows[0]?.requestsPerHour ?? null;
	}

	async set(userId: string, requestsPerHour: number): Promise<void> {
		await this.db
			.insert(llmUserRateLimits)
			.values({ userId, requestsPerHour })
			.onConflictDoUpdate({
				target: llmUserRateLimits.userId,
				set: { requestsPerHour, updatedAt: sql`NOW()` },
			});
	}

	async remove(userId: string): Promise<void> {
		await this.db
			.delete(llmUserRateLimits)
			.where(eq(llmUserRateLimits.userId, userId));
	}
}
