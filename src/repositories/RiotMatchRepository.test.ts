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
import type { RiotMatch } from "../services/riot/types";
import RiotMatchRepository from "./RiotMatchRepository";
import RiotMatchSyncRepository from "./RiotMatchSyncRepository";
import RiotUserLinkRepository from "./RiotUserLinkRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

function makeMatch(
	matchId: string,
	participants: Array<{
		puuid: string;
		timePlayed?: number;
		duration?: number;
	}>,
): RiotMatch {
	const gameDuration = participants[0]?.duration ?? 1800;
	return {
		metadata: {
			matchId,
			participants: participants.map((p) => p.puuid),
		},
		info: {
			gameCreation: Date.parse("2024-06-01T12:00:00Z"),
			gameDuration,
			queueId: 420,
			participants: participants.map((p) => ({
				puuid: p.puuid,
				championId: 1,
				championName: "A",
				champLevel: 18,
				kills: 0,
				deaths: 0,
				assists: 0,
				win: true,
				teamId: 100,
				totalMinionsKilled: 0,
				visionScore: 0,
				goldEarned: 0,
				item0: 0,
				item1: 0,
				item2: 0,
				item3: 0,
				item4: 0,
				item5: 0,
				item6: 0,
				timePlayed: p.timePlayed,
			})),
		},
	};
}

describeWithDb("RiotMatchRepository", () => {
	const db = createDatabase(DATABASE_URL_TESTING as string);
	const matches = new RiotMatchRepository(db);
	const sync = new RiotMatchSyncRepository(db);
	const links = new RiotUserLinkRepository(db);

	beforeAll(async () => {
		await migrateDatabase(db);
	});

	beforeEach(async () => {
		await db.execute(
			sql`TRUNCATE riot_match_participants, riot_matches, riot_match_sync, riot_user_links`,
		);
	});

	afterAll(async () => {
		await db.$client.close();
	});

	test("insert is idempotent and sums time_played", async () => {
		const match = makeMatch("NA1_1", [
			{ puuid: "p1", timePlayed: 1700 },
			{ puuid: "p2", timePlayed: 1600 },
		]);
		await matches.insertMatchWithParticipants(match);
		await matches.insertMatchWithParticipants(match);

		expect(await matches.sumTimePlayed("p1")).toBe(1700);
		expect(await matches.sumTimePlayed("p2")).toBe(1600);
		const known = await matches.existingMatchIds(["NA1_1", "NA1_2"]);
		expect(known.has("NA1_1")).toBe(true);
		expect(known.has("NA1_2")).toBe(false);
	});

	test("falls back to gameDuration when timePlayed missing", async () => {
		await matches.insertMatchWithParticipants(
			makeMatch("NA1_2", [{ puuid: "p1", duration: 2000 }]),
		);
		expect(await matches.sumTimePlayed("p1")).toBe(2000);
	});

	test("sum includes backfill_seconds and all linked accounts", async () => {
		await sync.setBackfill("p1", 500, new Date());
		await sync.setBackfill("p2", 300, new Date());
		await matches.insertMatchWithParticipants(
			makeMatch("NA1_3", [{ puuid: "p1", timePlayed: 100 }]),
		);
		await matches.insertMatchWithParticipants(
			makeMatch("NA1_4", [{ puuid: "p2", timePlayed: 50 }]),
		);
		await links.upsert({
			userId: "u1",
			puuid: "p1",
			platform: "na1",
			gameName: "A",
			tagLine: "1",
		});
		await links.upsert({
			userId: "u1",
			puuid: "p2",
			platform: "na1",
			gameName: "B",
			tagLine: "2",
		});

		expect(await matches.sumTimePlayed("p1")).toBe(600);
		expect(await matches.sumTimePlayedForUser("u1")).toBe(500 + 300 + 100 + 50);
	});
});
