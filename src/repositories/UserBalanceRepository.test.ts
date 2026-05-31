import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import UserBalanceRepository from "./UserBalanceRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("UserBalanceRepository", () => {
	const sql = new Bun.SQL(DATABASE_URL_TESTING as string);
	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE user_balances`;
	});

	afterAll(async () => {
		await sql.close();
	});

	test("applyProfit() initializes gain stats for new profitable user", async () => {
		const repo = new UserBalanceRepository(sql);
		const result = await repo.applyProfit("user-123", 250);
		expect(result).toEqual({
			userId: "user-123",
			balanceCents: 250,
			mostGainedCents: 250,
			mostLostCents: 0,
		});
	});

	test("applyProfit() initializes loss stats for new unprofitable user", async () => {
		const repo = new UserBalanceRepository(sql);
		const result = await repo.applyProfit("user-456", -125);
		expect(result).toEqual({
			userId: "user-456",
			balanceCents: -125,
			mostGainedCents: 0,
			mostLostCents: 125,
		});
	});

	test("applyProfit() accumulates balance across calls", async () => {
		const repo = new UserBalanceRepository(sql);
		await repo.applyProfit("user-789", 400);
		const result = await repo.applyProfit("user-789", 500);
		expect(result.balanceCents).toBe(900);
	});

	test("applyProfit() preserves max gain history", async () => {
		const repo = new UserBalanceRepository(sql);
		await repo.applyProfit("user-789", 500);
		const result = await repo.applyProfit("user-789", 300);
		expect(result.mostGainedCents).toBe(500);
	});

	test("applyProfit() preserves max loss history", async () => {
		const repo = new UserBalanceRepository(sql);
		await repo.applyProfit("user-789", -300);
		const result = await repo.applyProfit("user-789", -100);
		expect(result.mostLostCents).toBe(300);
	});

	test("getByUserId() returns an existing balance", async () => {
		const repo = new UserBalanceRepository(sql);
		await repo.applyProfit("user-123", 250);
		const result = await repo.getByUserId("user-123");
		expect(result).toEqual({
			userId: "user-123",
			balanceCents: 250,
			mostGainedCents: 250,
			mostLostCents: 0,
		});
	});

	test("getByUserId() returns null for an unknown user", async () => {
		const repo = new UserBalanceRepository(sql);
		await expect(repo.getByUserId("missing-user")).resolves.toBeNull();
	});

	test("getByUserId() does not create balance rows", async () => {
		const repo = new UserBalanceRepository(sql);
		await repo.getByUserId("missing-user");

		const rows = await sql<{ count: string }[]>`
			SELECT COUNT(*) AS count
			FROM user_balances
			WHERE user_id = ${"missing-user"}
		`;

		expect(rows[0]?.count).toBe("0");
	});
});
