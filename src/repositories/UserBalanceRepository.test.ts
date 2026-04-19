import { beforeEach, describe, expect, mock, test } from "bun:test";
import UserBalanceRepository from "./UserBalanceRepository";

const mockSql = mock((_strings: TemplateStringsArray, ..._values: unknown[]) =>
	Promise.resolve<unknown[]>([]),
);

const sql = mockSql as unknown as typeof Bun.sql;

describe("UserBalanceRepository", () => {
	beforeEach(() => {
		mockSql.mockReset();
		mockSql.mockImplementation(
			(_strings: TemplateStringsArray, ..._values: unknown[]) =>
				Promise.resolve<unknown[]>([]),
		);
	});

	test("applyProfit() initializes gain stats for a new profitable user", async () => {
		mockSql.mockResolvedValueOnce([
			{
				user_id: "user-123",
				balance_cents: 250,
				most_gained_cents: 250,
				most_lost_cents: 0,
			},
		]);

		const repo = new UserBalanceRepository(sql);
		const result = await repo.applyProfit("user-123", 250);

		expect(result).toEqual({
			userId: "user-123",
			balanceCents: 250,
			mostGainedCents: 250,
			mostLostCents: 0,
		});
		expect(mockSql).toHaveBeenCalledTimes(1);
		expect(mockSql.mock.calls[0]?.slice(1)).toEqual(["user-123", 250, 250, 0]);
	});

	test("applyProfit() initializes loss stats for a new unprofitable user", async () => {
		mockSql.mockResolvedValueOnce([
			{
				user_id: "user-456",
				balance_cents: -125,
				most_gained_cents: 0,
				most_lost_cents: 125,
			},
		]);

		const repo = new UserBalanceRepository(sql);
		const result = await repo.applyProfit("user-456", -125);

		expect(result).toEqual({
			userId: "user-456",
			balanceCents: -125,
			mostGainedCents: 0,
			mostLostCents: 125,
		});
		expect(mockSql).toHaveBeenCalledTimes(1);
		expect(mockSql.mock.calls[0]?.slice(1)).toEqual(["user-456", -125, 0, 125]);
	});

	test("applyProfit() updates existing balances without losing max gain and loss history", async () => {
		mockSql.mockResolvedValueOnce([
			{
				user_id: "user-789",
				balance_cents: 900,
				most_gained_cents: 500,
				most_lost_cents: 300,
			},
		]);

		const repo = new UserBalanceRepository(sql);
		await repo.applyProfit("user-789", 400);

		const query = mockSql.mock.calls[0]?.[0].join(" ");
		expect(query).toContain("ON CONFLICT (user_id) DO UPDATE");
		expect(query).toContain(
			"balance_cents = user_balances.balance_cents + EXCLUDED.balance_cents",
		);
		expect(query).toContain("most_gained_cents = GREATEST(");
		expect(query).toContain("most_lost_cents = GREATEST(");
		expect(query).toContain("updated_at = NOW()");
	});

	test("applyProfit() throws when persistence returns no balance row", async () => {
		mockSql.mockResolvedValueOnce([]);

		const repo = new UserBalanceRepository(sql);

		expect(repo.applyProfit("user-404", 10)).rejects.toThrow(
			"Failed to persist balance for user user-404.",
		);
	});
});
