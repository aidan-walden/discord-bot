import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import GuildSettingsRepository from "./GuildSettingsRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("GuildSettingsRepository", () => {
	const sql = new Bun.SQL(DATABASE_URL_TESTING as string);
	const repo = new GuildSettingsRepository(sql);

	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE guild_settings`;
	});

	afterAll(async () => {
		await sql.close();
	});

	test("setMainChannel inserts and get returns it", async () => {
		const set = await repo.setMainChannel("g1", "c1");
		expect(set).toMatchObject({ guildId: "g1", mainChannelId: "c1" });

		const got = await repo.get("g1");
		expect(got).toMatchObject({ guildId: "g1", mainChannelId: "c1" });
	});

	test("setMainChannel overwrites existing main channel", async () => {
		await repo.setMainChannel("g1", "c1");
		await repo.setMainChannel("g1", "c2");

		const got = await repo.get("g1");
		expect(got?.mainChannelId).toBe("c2");
	});

	test("get returns null for unknown guild", async () => {
		expect(await repo.get("missing")).toBeNull();
	});
});
