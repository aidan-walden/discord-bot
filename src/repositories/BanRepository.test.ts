import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import BanRepository from "./BanRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
if (!DATABASE_URL_TESTING) throw new Error("DATABASE_URL_TESTING is not set");
const sql = new Bun.SQL(DATABASE_URL_TESTING);

describe("BanRepository", () => {
	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE gpt_user_bans, music_user_bans, music_guild_bans`;
	});

	afterAll(async () => {
		await sql.close();
	});

	test("has() returns true when record exists", async () => {
		await sql`INSERT INTO gpt_user_bans (user_id) VALUES ('user-123')`;
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		expect(await repo.has("user-123")).toBe(true);
	});

	test("has() returns false when record does not exist", async () => {
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		expect(await repo.has("user-123")).toBe(false);
	});

	test("add() inserts record", async () => {
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		await repo.add("user-123");
		expect(await repo.has("user-123")).toBe(true);
	});

	test("add() is idempotent on duplicate", async () => {
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		await repo.add("user-123");
		await expect(repo.add("user-123")).resolves.toBeUndefined();
	});

	test("remove() deletes record", async () => {
		await sql`INSERT INTO gpt_user_bans (user_id) VALUES ('user-123')`;
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		await repo.remove("user-123");
		expect(await repo.has("user-123")).toBe(false);
	});

	test("list() returns ids sorted ascending", async () => {
		await sql`INSERT INTO gpt_user_bans (user_id) VALUES ('user-zzz'), ('user-aaa'), ('user-mmm')`;
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		expect(await repo.list()).toEqual(["user-aaa", "user-mmm", "user-zzz"]);
	});

	test("list() returns empty array when no records", async () => {
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		expect(await repo.list()).toEqual([]);
	});

	test("uses guild_id column for music_guild_bans", async () => {
		const repo = new BanRepository(sql, "music_guild_bans", "guild_id");
		await repo.add("guild-123");
		expect(await repo.has("guild-123")).toBe(true);
		expect(await repo.list()).toEqual(["guild-123"]);
	});
});
