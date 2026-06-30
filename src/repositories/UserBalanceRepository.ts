export type UserBalance = {
	userId: string;
	balanceCents: number;
	mostGainedCents: number;
	mostLostCents: number;
	totalSpentCents: number;
	totalGainedCents: number;
	unboxCount: number;
};

type UserBalanceRow = {
	user_id: string;
	balance_cents: number;
	most_gained_cents: number;
	most_lost_cents: number;
	total_spent_cents: number;
	total_gained_cents: number;
	unbox_count: number;
};

function mapRow(row: UserBalanceRow): UserBalance {
	return {
		userId: row.user_id,
		balanceCents: row.balance_cents,
		mostGainedCents: row.most_gained_cents,
		mostLostCents: row.most_lost_cents,
		totalSpentCents: row.total_spent_cents,
		totalGainedCents: row.total_gained_cents,
		unboxCount: row.unbox_count,
	};
}

export default class UserBalanceRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	async getByUserId(userId: string): Promise<UserBalance | null> {
		const rows = await this.sql<UserBalanceRow[]>`
			SELECT
				user_id,
				balance_cents,
				most_gained_cents,
				most_lost_cents,
				total_spent_cents,
				total_gained_cents,
				unbox_count
			FROM user_balances
			WHERE user_id = ${userId}
		`;

		const balance = rows[0];
		if (!balance) {
			return null;
		}

		return mapRow(balance);
	}

	async getTop(limit: number): Promise<UserBalance[]> {
		const rows = await this.sql<UserBalanceRow[]>`
			SELECT
				user_id,
				balance_cents,
				most_gained_cents,
				most_lost_cents,
				total_spent_cents,
				total_gained_cents,
				unbox_count
			FROM user_balances
			ORDER BY balance_cents DESC
			LIMIT ${limit}
		`;

		return rows.map(mapRow);
	}

	async applyProfit(
		userId: string,
		profitCents: number,
		spentCents: number,
		gainedCents: number,
	): Promise<UserBalance> {
		const rows = await this.sql<UserBalanceRow[]>`
			INSERT INTO user_balances (
				user_id,
				balance_cents,
				most_gained_cents,
				most_lost_cents,
				total_spent_cents,
				total_gained_cents,
				unbox_count
			)
			VALUES (
				${userId},
				${profitCents},
				${profitCents > 0 ? profitCents : 0},
				${profitCents < 0 ? Math.abs(profitCents) : 0},
				${spentCents},
				${gainedCents},
				1
			)
			ON CONFLICT (user_id) DO UPDATE
			SET
				balance_cents = user_balances.balance_cents + EXCLUDED.balance_cents,
				most_gained_cents = GREATEST(
					user_balances.most_gained_cents,
					EXCLUDED.most_gained_cents
				),
				most_lost_cents = GREATEST(
					user_balances.most_lost_cents,
					EXCLUDED.most_lost_cents
				),
				total_spent_cents = user_balances.total_spent_cents + EXCLUDED.total_spent_cents,
				total_gained_cents = user_balances.total_gained_cents + EXCLUDED.total_gained_cents,
				unbox_count = user_balances.unbox_count + 1,
				updated_at = NOW()
			RETURNING
				user_id,
				balance_cents,
				most_gained_cents,
				most_lost_cents,
				total_spent_cents,
				total_gained_cents,
				unbox_count
		`;

		const balance = rows[0];
		if (!balance) {
			throw new Error(`Failed to persist balance for user ${userId}.`);
		}

		return mapRow(balance);
	}
}
