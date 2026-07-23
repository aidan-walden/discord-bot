import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { count, eq, sql } from "drizzle-orm";
import { createDatabase } from "../database/client";
import { migrateDatabase } from "../database/migrate";
import { userBalances } from "../database/schema";
import UserBalanceRepository from "./UserBalanceRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("UserBalanceRepository", () => {
	const db = createDatabase(DATABASE_URL_TESTING as string);
	beforeAll(async () => {
		await migrateDatabase(db);
	});

	beforeEach(async () => {
		await db.execute(sql`TRUNCATE user_balances`);
	});

	afterAll(async () => {
		await db.$client.close();
	});

	test("applyProfit() initializes gain stats for new profitable user", async () => {
		const repo = new UserBalanceRepository(db);
		const result = await repo.applyProfit("user-123", 250, 1000, 1250);
		expect(result).toEqual({
			userId: "user-123",
			balanceCents: 250,
			mostGainedCents: 250,
			mostLostCents: 0,
			totalSpentCents: 1000,
			totalGainedCents: 1250,
			unboxCount: 1,
		});
	});

	test("applyProfit() initializes loss stats for new unprofitable user", async () => {
		const repo = new UserBalanceRepository(db);
		const result = await repo.applyProfit("user-456", -125, 500, 375);
		expect(result).toEqual({
			userId: "user-456",
			balanceCents: -125,
			mostGainedCents: 0,
			mostLostCents: 125,
			totalSpentCents: 500,
			totalGainedCents: 375,
			unboxCount: 1,
		});
	});

	test("applyProfit() accumulates balance across calls", async () => {
		const repo = new UserBalanceRepository(db);
		await repo.applyProfit("user-789", 400, 1000, 1400);
		const result = await repo.applyProfit("user-789", 500, 800, 1300);
		expect(result.balanceCents).toBe(900);
	});

	test("applyProfit() accumulates spent, gained, and unbox count", async () => {
		const repo = new UserBalanceRepository(db);
		await repo.applyProfit("user-789", 400, 1000, 1400);
		const result = await repo.applyProfit("user-789", 500, 800, 1300);
		expect(result.totalSpentCents).toBe(1800);
		expect(result.totalGainedCents).toBe(2700);
		expect(result.unboxCount).toBe(2);
	});

	test("applyProfit() preserves max gain history", async () => {
		const repo = new UserBalanceRepository(db);
		await repo.applyProfit("user-789", 500, 1000, 1500);
		const result = await repo.applyProfit("user-789", 300, 1000, 1300);
		expect(result.mostGainedCents).toBe(500);
	});

	test("applyProfit() preserves max loss history", async () => {
		const repo = new UserBalanceRepository(db);
		await repo.applyProfit("user-789", -300, 1000, 700);
		const result = await repo.applyProfit("user-789", -100, 1000, 900);
		expect(result.mostLostCents).toBe(300);
	});

	test("getTop() returns balances ordered by balance descending", async () => {
		const repo = new UserBalanceRepository(db);
		await repo.applyProfit("low", 100, 1000, 1100);
		await repo.applyProfit("high", 900, 1000, 1900);
		await repo.applyProfit("mid", 500, 1000, 1500);

		const result = await repo.getTop(2);
		expect(result.map((entry) => entry.userId)).toEqual(["high", "mid"]);
	});

	test("getByUserId() returns an existing balance", async () => {
		const repo = new UserBalanceRepository(db);
		await repo.applyProfit("user-123", 250, 1000, 1250);
		const result = await repo.getByUserId("user-123");
		expect(result).toEqual({
			userId: "user-123",
			balanceCents: 250,
			mostGainedCents: 250,
			mostLostCents: 0,
			totalSpentCents: 1000,
			totalGainedCents: 1250,
			unboxCount: 1,
		});
	});

	test("getByUserId() returns null for an unknown user", async () => {
		const repo = new UserBalanceRepository(db);
		await expect(repo.getByUserId("missing-user")).resolves.toBeNull();
	});

	test("getByUserId() does not create balance rows", async () => {
		const repo = new UserBalanceRepository(db);
		await repo.getByUserId("missing-user");

		const rows = await db
			.select({ count: count() })
			.from(userBalances)
			.where(eq(userBalances.userId, "missing-user"));

		expect(rows[0]?.count).toBe(0);
	});
});
