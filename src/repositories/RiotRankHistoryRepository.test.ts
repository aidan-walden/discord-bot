import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import RiotRankHistoryRepository from "./RiotRankHistoryRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("RiotRankHistoryRepository", () => {
	const sql = new Bun.SQL(DATABASE_URL_TESTING as string);
	const repo = new RiotRankHistoryRepository(sql);

	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE riot_rank_history`;
	});

	afterAll(async () => {
		await sql.close();
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

		const count = await sql<{ n: number }[]>`
			SELECT COUNT(*)::int AS n FROM riot_rank_history WHERE puuid = ${"p1"}
		`;
		expect(count[0]?.n).toBe(5);
	});
});
