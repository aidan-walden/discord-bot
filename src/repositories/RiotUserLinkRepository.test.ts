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

	test("upserts and gets primary by user id", async () => {
		const link = await repo.upsert({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "Faker",
			tagLine: "KR1",
		});
		expect(link.userId).toBe("u1");
		expect(link.puuid).toBe("p1");

		const got = await repo.getPrimaryByUserId("u1");
		expect(got).toMatchObject({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "Faker",
			tagLine: "KR1",
		});
	});

	test("allows multiple puuids per discord user (smurfs)", async () => {
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

		const list = await repo.listByUserId("u1");
		expect(list).toHaveLength(2);
		expect(list.map((l) => l.puuid).sort()).toEqual(["p1", "p2"]);
		expect((await repo.listAll()).map((l) => l.puuid).sort()).toEqual([
			"p1",
			"p2",
		]);
	});

	test("primary is newest linked_at", async () => {
		await repo.upsert({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "Old",
			tagLine: "1",
		});
		await new Promise((r) => setTimeout(r, 5));
		await repo.upsert({
			userId: "u1",
			puuid: "p2",
			platform: "na1",
			gameName: "New",
			tagLine: "2",
		});
		const primary = await repo.getPrimaryByUserId("u1");
		expect(primary?.puuid).toBe("p2");
	});

	test("same puuid transfers to another discord user", async () => {
		await repo.upsert({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "A",
			tagLine: "1",
		});
		await repo.upsert({
			userId: "u2",
			puuid: "p1",
			platform: "na1",
			gameName: "A",
			tagLine: "1",
		});
		expect(await repo.getPrimaryByUserId("u1")).toBeNull();
		expect(await repo.getPrimaryByUserId("u2")).toMatchObject({
			userId: "u2",
			puuid: "p1",
		});
	});
});
