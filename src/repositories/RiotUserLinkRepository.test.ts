import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import RiotUserLinkRepository from "./RiotUserLinkRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("RiotUserLinkRepository", () => {
	const sql = new Bun.SQL(DATABASE_URL_TESTING as string);
	const repo = new RiotUserLinkRepository(sql);

	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE riot_user_links`;
	});

	afterAll(async () => {
		await sql.close();
	});

	test("upserts and gets by user id", async () => {
		const link = await repo.upsert({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "Faker",
			tagLine: "KR1",
		});
		expect(link.userId).toBe("u1");
		expect(link.puuid).toBe("p1");

		const got = await repo.getByUserId("u1");
		expect(got).toMatchObject({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "Faker",
			tagLine: "KR1",
		});
	});

	test("overwrite replaces link for same user", async () => {
		await repo.upsert({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "A",
			tagLine: "TAG",
		});
		await repo.upsert({
			userId: "u1",
			puuid: "p2",
			platform: "euw1",
			gameName: "B",
			tagLine: "EUW",
		});

		const got = await repo.getByUserId("u1");
		expect(got).toMatchObject({
			puuid: "p2",
			platform: "euw1",
			gameName: "B",
			tagLine: "EUW",
		});
	});
});
