import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import { userBalances } from "../database/schema";

export type UserBalance = Omit<typeof userBalances.$inferSelect, "updatedAt">;

const columns = {
	userId: userBalances.userId,
	balanceCents: userBalances.balanceCents,
	mostGainedCents: userBalances.mostGainedCents,
	mostLostCents: userBalances.mostLostCents,
	totalSpentCents: userBalances.totalSpentCents,
	totalGainedCents: userBalances.totalGainedCents,
	unboxCount: userBalances.unboxCount,
};

export default class UserBalanceRepository {
	constructor(private readonly db: Database) {}

	async getByUserId(userId: string): Promise<UserBalance | null> {
		const rows = await this.db
			.select(columns)
			.from(userBalances)
			.where(eq(userBalances.userId, userId));
		return rows[0] ?? null;
	}

	async getTop(limit: number): Promise<UserBalance[]> {
		return this.db
			.select(columns)
			.from(userBalances)
			.orderBy(desc(userBalances.balanceCents))
			.limit(limit);
	}

	async applyProfit(
		userId: string,
		profitCents: number,
		spentCents: number,
		gainedCents: number,
	): Promise<UserBalance> {
		const rows = await this.db
			.insert(userBalances)
			.values({
				userId,
				balanceCents: profitCents,
				mostGainedCents: profitCents > 0 ? profitCents : 0,
				mostLostCents: profitCents < 0 ? Math.abs(profitCents) : 0,
				totalSpentCents: spentCents,
				totalGainedCents: gainedCents,
				unboxCount: 1,
			})
			.onConflictDoUpdate({
				target: userBalances.userId,
				set: {
					balanceCents: sql`${userBalances.balanceCents} + EXCLUDED.balance_cents`,
					mostGainedCents: sql`GREATEST(${userBalances.mostGainedCents}, EXCLUDED.most_gained_cents)`,
					mostLostCents: sql`GREATEST(${userBalances.mostLostCents}, EXCLUDED.most_lost_cents)`,
					totalSpentCents: sql`${userBalances.totalSpentCents} + EXCLUDED.total_spent_cents`,
					totalGainedCents: sql`${userBalances.totalGainedCents} + EXCLUDED.total_gained_cents`,
					unboxCount: sql`${userBalances.unboxCount} + 1`,
					updatedAt: sql`NOW()`,
				},
			})
			.returning(columns);

		const balance = rows[0];
		if (!balance) {
			throw new Error(`Failed to persist balance for user ${userId}.`);
		}
		return balance;
	}
}
