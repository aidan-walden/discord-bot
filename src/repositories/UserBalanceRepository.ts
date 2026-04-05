export type UserBalance = {
	userId: string;
	balanceCents: number;
	mostGainedCents: number;
	mostLostCents: number;
};

export default class UserBalanceRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	async applyProfit(userId: string, profitCents: number): Promise<UserBalance> {
		const rows = await this.sql<
			{
				user_id: string;
				balance_cents: number;
				most_gained_cents: number;
				most_lost_cents: number;
			}[]
		>`
			INSERT INTO user_balances (
				user_id,
				balance_cents,
				most_gained_cents,
				most_lost_cents
			)
			VALUES (
				${userId},
				${profitCents},
				${profitCents > 0 ? profitCents : 0},
				${profitCents < 0 ? Math.abs(profitCents) : 0}
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
				updated_at = NOW()
			RETURNING
				user_id,
				balance_cents,
				most_gained_cents,
				most_lost_cents
		`;

		const balance = rows[0];
		if (!balance) {
			throw new Error(`Failed to persist balance for user ${userId}.`);
		}

		return {
			userId: balance.user_id,
			balanceCents: balance.balance_cents,
			mostGainedCents: balance.most_gained_cents,
			mostLostCents: balance.most_lost_cents,
		};
	}
}
