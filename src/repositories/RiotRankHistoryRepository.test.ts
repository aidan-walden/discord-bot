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
import { riotRankHistory } from "../database/schema";
import RiotRankHistoryRepository from "./RiotRankHistoryRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("RiotRankHistoryRepository", () => {
	const db = createDatabase(DATABASE_URL_TESTING as string);
	const repo = new RiotRankHistoryRepository(db);

	beforeAll(async () => {
		await migrateDatabase(db);
	});

	beforeEach(async () => {
		await db.execute(sql`TRUNCATE riot_rank_history`);
	});

	afterAll(async () => {
		await db.$client.close();
	});

	test("inserts on change and skips identical rank", async () => {
		const rank = {
			tier: "GOLD",
			rank: "II",
			leaguePoints: 50,
			wins: 10,
			losses: 8,
		};
		const first = await repo.recordIfChanged("p1", rank);
		expect(first).not.toBeNull();
		expect(first?.leaguePoints).toBe(50);

		const same = await repo.recordIfChanged("p1", rank);
		expect(same).toBeNull();

		const rows = await repo.listByPuuid("p1");
		expect(rows).toHaveLength(1);
	});

	test("lists newest first and trims to 5", async () => {
		for (let lp = 1; lp <= 7; lp++) {
			await repo.recordIfChanged(
				"p1",
				{
					tier: "GOLD",
					rank: "II",
					leaguePoints: lp,
					wins: lp,
					losses: 0,
				},
				new Date(1_000_000 + lp * 1000),
			);
		}

		const rows = await repo.listByPuuid("p1");
		expect(rows).toHaveLength(5);
		expect(rows.map((r) => r.leaguePoints)).toEqual([7, 6, 5, 4, 3]);

		const countRows = await db
			.select({ count: count() })
			.from(riotRankHistory)
			.where(eq(riotRankHistory.puuid, "p1"));
		expect(countRows[0]?.count).toBe(5);
	});
});
