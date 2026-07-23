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
import { gptUserBans, musicGuildBans } from "../database/schema";
import BanRepository from "./BanRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("BanRepository", () => {
	const db = createDatabase(DATABASE_URL_TESTING as string);
	beforeAll(async () => {
		await migrateDatabase(db);
	});

	beforeEach(async () => {
		await db.execute(
			sql`TRUNCATE gpt_user_bans, music_user_bans, music_guild_bans`,
		);
	});

	afterAll(async () => {
		await db.$client.close();
	});

	test("has() returns true when record exists", async () => {
		await db.insert(gptUserBans).values({ id: "user-123" });
		const repo = new BanRepository(db, gptUserBans);
		expect(await repo.has("user-123")).toBe(true);
	});

	test("has() returns false when record does not exist", async () => {
		const repo = new BanRepository(db, gptUserBans);
		expect(await repo.has("user-123")).toBe(false);
	});

	test("add() inserts record", async () => {
		const repo = new BanRepository(db, gptUserBans);
		await repo.add("user-123");
		expect(await repo.has("user-123")).toBe(true);
	});

	test("add() is idempotent on duplicate", async () => {
		const repo = new BanRepository(db, gptUserBans);
		await repo.add("user-123");
		await expect(repo.add("user-123")).resolves.toBeUndefined();
	});

	test("remove() deletes record", async () => {
		await db.insert(gptUserBans).values({ id: "user-123" });
		const repo = new BanRepository(db, gptUserBans);
		await repo.remove("user-123");
		expect(await repo.has("user-123")).toBe(false);
	});

	test("list() returns ids sorted ascending", async () => {
		await db
			.insert(gptUserBans)
			.values([{ id: "user-zzz" }, { id: "user-aaa" }, { id: "user-mmm" }]);
		const repo = new BanRepository(db, gptUserBans);
		expect(await repo.list()).toEqual(["user-aaa", "user-mmm", "user-zzz"]);
	});

	test("list() returns empty array when no records", async () => {
		const repo = new BanRepository(db, gptUserBans);
		expect(await repo.list()).toEqual([]);
	});

	test("uses guild_id column for music_guild_bans", async () => {
		const repo = new BanRepository(db, musicGuildBans);
		await repo.add("guild-123");
		expect(await repo.has("guild-123")).toBe(true);
		expect(await repo.list()).toEqual(["guild-123"]);
	});
});
