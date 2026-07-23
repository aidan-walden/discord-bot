import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import RiotMatchSyncRepository from "./RiotMatchSyncRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("RiotMatchSyncRepository", () => {
	const sql = new Bun.SQL(DATABASE_URL_TESTING as string);
	const repo = new RiotMatchSyncRepository(sql);

	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE riot_match_sync`;
	});

	afterAll(async () => {
		await sql.close();
	});

	test("setBackfill then get", async () => {
		const at = new Date("2024-01-01T00:00:00Z");
		await repo.setBackfill("p1", 3600, at);
		const row = await repo.get("p1");
		expect(row).toMatchObject({
			puuid: "p1",
			backfilled: true,
			backfillSeconds: 3600,
		});
		expect(row?.lastSyncedAt.toISOString()).toBe(at.toISOString());
	});

	test("touchSynced advances cursor without clearing backfill", async () => {
		const t1 = new Date("2024-01-01T00:00:00Z");
		const t2 = new Date("2024-01-02T00:00:00Z");
		await repo.setBackfill("p1", 100, t1);
		await repo.touchSynced("p1", t2);
		const row = await repo.get("p1");
		expect(row?.backfillSeconds).toBe(100);
		expect(row?.backfilled).toBe(true);
		expect(row?.lastSyncedAt.toISOString()).toBe(t2.toISOString());
	});
});
