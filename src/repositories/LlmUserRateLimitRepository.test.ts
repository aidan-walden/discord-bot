import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../database/client";
import { migrateDatabase } from "../database/migrate";
import LlmUserRateLimitRepository from "./LlmUserRateLimitRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("LlmUserRateLimitRepository", () => {
	const db = createDatabase(DATABASE_URL_TESTING as string);
	const repo = new LlmUserRateLimitRepository(db);

	beforeAll(async () => {
		await migrateDatabase(db);
	});

	beforeEach(async () => {
		await db.execute(sql`TRUNCATE llm_user_rate_limits`);
	});

	afterAll(async () => {
		await db.$client.close();
	});

	test("sets, replaces, and removes an override", async () => {
		expect(await repo.get("user-1")).toBeNull();

		await repo.set("user-1", 10);
		expect(await repo.get("user-1")).toBe(10);

		await repo.set("user-1", -1);
		expect(await repo.get("user-1")).toBe(-1);

		await repo.remove("user-1");
		expect(await repo.get("user-1")).toBeNull();
	});

	test.each([0, -2])("database rejects %i", async (value) => {
		await expect(repo.set("user-1", value)).rejects.toThrow();
	});
});
