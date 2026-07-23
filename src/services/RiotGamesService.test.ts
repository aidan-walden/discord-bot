import { describe, expect, mock, test } from "bun:test";
import RiotGamesService, {
	platformToRegion,
	RiotGamesError,
	type RiotRank,
} from "./RiotGamesService";

function jsonResponse(
	body: unknown,
	init: {
		status?: number;
		headers?: Record<string, string>;
	} = {},
): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});
}

const PLAYER = { riotId: "Hide#NA1", platform: "na1" as const };

function participant(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		puuid: "p1",
		championId: 64,
		championName: "LeeSin",
		champLevel: 18,
		kills: 5,
		deaths: 2,
		assists: 10,
		win: true,
		teamId: 100,
		totalMinionsKilled: 150,
		visionScore: 20,
		goldEarned: 12000,
		item0: 0,
		item1: 0,
		item2: 0,
		item3: 0,
		item4: 0,
		item5: 0,
		item6: 0,
		...overrides,
	};
}

describe("platformToRegion", () => {
	test("maps common platforms", () => {
		expect(platformToRegion("na1")).toBe("americas");
		expect(platformToRegion("euw1")).toBe("europe");
		expect(platformToRegion("kr")).toBe("asia");
		expect(platformToRegion("oc1")).toBe("sea");
	});
});

describe("RiotGamesService", () => {
	test("is unavailable without key and returns empty lookups", async () => {
		const fetcher = mock(async () => jsonResponse({}));
		const service = new RiotGamesService(null, undefined, { fetch: fetcher });

		expect(service.isAvailable()).toBe(false);
		expect(await service.getAccountByRiotId("americas", "A", "B")).toBeNull();
		expect(await service.getAccountByPuuid("americas", "p")).toBeNull();
		expect(await service.getMatchIdsByPuuid("americas", "puuid")).toEqual([]);
		expect(await service.getMatch("americas", "NA1_1")).toBeNull();
		expect(await service.getLeagueEntriesByPuuid("na1", "puuid")).toEqual([]);
		expect(await service.getActiveGame("na1", "puuid")).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});

	test("fetches account by riot id with token header", async () => {
		const account = {
			puuid: "p1",
			gameName: "Hide on bush",
			tagLine: "KR1",
		};
		const fetcher = mock(async () => jsonResponse(account));
		const service = new RiotGamesService("riot-key", undefined, {
			fetch: fetcher,
		});

		const result = await service.getAccountByRiotId(
			"asia",
			"Hide on bush",
			"KR1",
		);

		expect(result).toEqual(account);
		expect(fetcher).toHaveBeenCalledWith(
			"https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Hide%20on%20bush/KR1",
			{ headers: { "X-Riot-Token": "riot-key" } },
		);
	});

	test("fetches account by puuid", async () => {
		const account = { puuid: "p1", gameName: "Hide", tagLine: "NA1" };
		const fetcher = mock(async () => jsonResponse(account));
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });

		expect(await service.getAccountByPuuid("americas", "p1")).toEqual(account);
		expect(fetcher).toHaveBeenCalledWith(
			"https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/p1",
			{ headers: { "X-Riot-Token": "key" } },
		);
	});

	test("returns null on 404 for account and match", async () => {
		const fetcher = mock(async () => new Response(null, { status: 404 }));
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });

		expect(await service.getAccountByRiotId("americas", "x", "y")).toBeNull();
		expect(await service.getAccountByPuuid("americas", "p")).toBeNull();
		expect(await service.getMatch("americas", "NA1_1")).toBeNull();
	});

	test("reports credential rejection on 401/403", async () => {
		const recordCredentialRejection = mock(() => undefined);
		const fetcher = mock(async () => new Response(null, { status: 403 }));
		const service = new RiotGamesService(
			"bad-key",
			{ recordCredentialRejection },
			{ fetch: fetcher },
		);

		await expect(
			service.getAccountByRiotId("americas", "a", "b"),
		).rejects.toBeInstanceOf(RiotGamesError);
		expect(recordCredentialRejection).toHaveBeenCalledWith("riot");
	});

	test("retries once on 429 using Retry-After and does not report credentials", async () => {
		const sleeps: number[] = [];
		const recordCredentialRejection = mock(() => undefined);
		const fetcher = mock(async () => {
			if (fetcher.mock.calls.length === 1) {
				return new Response(null, {
					status: 429,
					headers: { "Retry-After": "2" },
				});
			}
			return jsonResponse({
				puuid: "p",
				gameName: "a",
				tagLine: "b",
			});
		});
		const service = new RiotGamesService(
			"key",
			{ recordCredentialRejection },
			{
				fetch: fetcher,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			},
		);

		const account = await service.getAccountByRiotId("americas", "a", "b");
		expect(account?.puuid).toBe("p");
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(sleeps).toEqual([2000]);
		expect(recordCredentialRejection).not.toHaveBeenCalled();
	});

	test("throws on second 429", async () => {
		const fetcher = mock(
			async () =>
				new Response(null, {
					status: 429,
					headers: { "Retry-After": "1" },
				}),
		);
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			sleep: async () => undefined,
		});

		await expect(
			service.getAccountByRiotId("americas", "a", "b"),
		).rejects.toMatchObject({ status: 429 });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	test("throws on 500 without credential rejection", async () => {
		const recordCredentialRejection = mock(() => undefined);
		const fetcher = mock(async () => new Response(null, { status: 500 }));
		const service = new RiotGamesService(
			"key",
			{ recordCredentialRejection },
			{ fetch: fetcher },
		);

		await expect(
			service.getMatchIdsByPuuid("americas", "puuid"),
		).rejects.toBeInstanceOf(RiotGamesError);
		expect(recordCredentialRejection).not.toHaveBeenCalled();
	});

	test("caches match by id within TTL", async () => {
		let now = 1_000;
		const match = {
			metadata: { matchId: "NA1_1", participants: ["p"] },
			info: {
				gameCreation: 1,
				gameDuration: 2,
				queueId: 420,
				participants: [],
			},
		};
		const fetcher = mock(async () => jsonResponse(match));
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			now: () => now,
		});

		expect(await service.getMatch("americas", "NA1_1")).toEqual(match);
		expect(await service.getMatch("americas", "NA1_1")).toEqual(match);
		expect(fetcher).toHaveBeenCalledTimes(1);

		now += 60 * 60_000 + 1;
		expect(await service.getMatch("americas", "NA1_1")).toEqual(match);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	test("caches league entries and summoner within TTL; not match id lists", async () => {
		let now = 1_000;
		const fetcher = mock(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("/ids")) {
				return jsonResponse(["m1"]);
			}
			if (href.includes("/summoner/")) {
				return jsonResponse({
					puuid: "p",
					profileIconId: 1,
					summonerLevel: 10,
				});
			}
			return jsonResponse([
				{
					queueType: "RANKED_SOLO_5x5",
					tier: "GOLD",
					rank: "I",
					leaguePoints: 10,
					wins: 1,
					losses: 2,
				},
			]);
		});
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			now: () => now,
		});

		await service.getMatchIdsByPuuid("americas", "p");
		await service.getMatchIdsByPuuid("americas", "p");
		await service.getLeagueEntriesByPuuid("na1", "p");
		await service.getLeagueEntriesByPuuid("na1", "p");
		await service.getSummonerByPuuid("na1", "p");
		await service.getSummonerByPuuid("na1", "p");
		// match ids ×2 + league ×1 + summoner ×1
		expect(fetcher).toHaveBeenCalledTimes(4);

		now += 60_000 + 1;
		await service.getLeagueEntriesByPuuid("na1", "p");
		expect(fetcher).toHaveBeenCalledTimes(5);
	});

	test("does not cache active game", async () => {
		const fetcher = mock(async () => new Response(null, { status: 404 }));
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });
		await service.getActiveGame("na1", "p");
		await service.getActiveGame("na1", "p");
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	test("waits on default app rate limit without prior headers", async () => {
		const sleeps: number[] = [];
		let now = 0;
		const fetcher = mock(async () =>
			jsonResponse({ puuid: "p", gameName: "a", tagLine: "b" }),
		);
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			now: () => now,
			sleep: async (ms) => {
				sleeps.push(ms);
				now += ms;
			},
		});

		for (let i = 0; i < 20; i++) {
			service.clearCache();
			await service.getAccountByRiotId("americas", `a${i}`, "b");
		}
		expect(sleeps).toEqual([]);

		service.clearCache();
		await service.getAccountByRiotId("americas", "a20", "b");
		expect(sleeps.length).toBe(1);
		expect(sleeps[0]).toBeGreaterThan(0);
	});

	test("getLolView caches 5 minutes per puuid", async () => {
		let now = 1_000;
		const fetcher = mock(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("/accounts/by-puuid/")) {
				return jsonResponse({
					puuid: href.includes("p2") ? "p2" : "p1",
					gameName: href.includes("p2") ? "Two" : "One",
					tagLine: "NA1",
				});
			}
			if (href.includes("/active-games/")) {
				return new Response(null, { status: 404 });
			}
			if (href.includes("/ids")) {
				return jsonResponse([]);
			}
			if (href.includes("/league/")) {
				return jsonResponse([]);
			}
			if (href.includes("/summoner/")) {
				return jsonResponse({
					puuid: "p1",
					profileIconId: 1,
					summonerLevel: 1,
				});
			}
			return new Response(null, { status: 500 });
		});
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			now: () => now,
		});

		const first = await service.getLolView("na1", "p1");
		const second = await service.getLolView("na1", "p1");
		expect(first).toEqual(second);
		const callsAfterFirstPlayer = fetcher.mock.calls.length;

		await service.getLolView("na1", "p1");
		expect(fetcher).toHaveBeenCalledTimes(callsAfterFirstPlayer);

		await service.getLolView("na1", "p2");
		expect(fetcher.mock.calls.length).toBeGreaterThan(callsAfterFirstPlayer);

		const afterP2 = fetcher.mock.calls.length;
		now += 5 * 60_000 + 1;
		await service.getLolView("na1", "p1");
		expect(fetcher.mock.calls.length).toBeGreaterThan(afterP2);
	});

	test("waits when app rate-limit bucket is exhausted", async () => {
		const sleeps: number[] = [];
		let now = 10_000;
		const fetcher = mock(async () => {
			if (fetcher.mock.calls.length === 1) {
				return jsonResponse(
					{ puuid: "p", gameName: "a", tagLine: "b" },
					{
						headers: {
							"X-App-Rate-Limit": "1:10",
							"X-App-Rate-Limit-Count": "1:10",
						},
					},
				);
			}
			return jsonResponse({
				metadata: { matchId: "NA1_1", participants: [] },
				info: {
					gameCreation: 1,
					gameDuration: 1,
					queueId: 420,
					participants: [],
				},
			});
		});
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			now: () => now,
			sleep: async (ms) => {
				sleeps.push(ms);
				now += ms;
			},
		});

		await service.getAccountByRiotId("americas", "a", "b");
		await service.getMatch("americas", "NA1_1");

		expect(sleeps.length).toBe(1);
		expect(sleeps[0]).toBeGreaterThan(0);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	test("getMatchIdsByPuuid passes query params", async () => {
		const fetcher = mock(async () => jsonResponse(["m1", "m2"]));
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });

		await service.getMatchIdsByPuuid("europe", "abc", {
			start: 5,
			count: 10,
			startTime: 1700000000,
			queue: 420,
		});
		expect(fetcher).toHaveBeenCalledWith(
			"https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/abc/ids?start=5&count=10&startTime=1700000000&queue=420",
			{ headers: { "X-Riot-Token": "key" } },
		);
	});

	test("getSummonerByPuuid returns summoner and null on 404", async () => {
		const summoner = {
			puuid: "p1",
			profileIconId: 7,
			summonerLevel: 420,
		};
		const fetcher = mock(async () => jsonResponse(summoner));
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });

		expect(await service.getSummonerByPuuid("na1", "p1")).toEqual(summoner);
		expect(fetcher).toHaveBeenCalledWith(
			"https://na1.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/p1",
			{ headers: { "X-Riot-Token": "key" } },
		);

		const notFound = mock(async () => new Response(null, { status: 404 }));
		const service404 = new RiotGamesService("key", undefined, {
			fetch: notFound,
		});
		expect(await service404.getSummonerByPuuid("na1", "p1")).toBeNull();
	});

	test("getActiveGame returns game and null on 404", async () => {
		const game = {
			gameId: 1,
			gameStartTime: 100,
			gameLength: 50,
			gameMode: "CLASSIC",
			gameQueueConfigId: 420,
			participants: [{ puuid: "p1", championId: 99 }],
		};
		const fetcher = mock(async () => jsonResponse(game));
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });

		expect(await service.getActiveGame("na1", "p1")).toEqual(game);
		expect(fetcher).toHaveBeenCalledWith(
			"https://na1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/p1",
			{ headers: { "X-Riot-Token": "key" } },
		);

		const notFound = mock(async () => new Response(null, { status: 404 }));
		const service404 = new RiotGamesService("key", undefined, {
			fetch: notFound,
		});
		expect(await service404.getActiveGame("na1", "p1")).toBeNull();
	});

	test("pollOnce does not throw when Riot returns HTTP 400", async () => {
		const fetcher = mock(
			async () =>
				new Response(JSON.stringify({ status: { message: "Bad request" } }), {
					status: 400,
				}),
		);
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			players: [PLAYER],
		});
		const errorSpy = mock(() => undefined);
		const originalError = console.error;
		console.error = errorSpy as typeof console.error;
		try {
			await expect(service.pollOnce()).resolves.toBeUndefined();
		} finally {
			console.error = originalError;
		}
		expect(errorSpy).toHaveBeenCalled();
		expect(service.getPollState("p1")).toBeNull();
	});

	test("pollOnce resolves riotId via by-riot-id then uses returned puuid", async () => {
		const account = { puuid: "p1", gameName: "Hide", tagLine: "NA1" };
		const urls: string[] = [];
		const fetcher = mock(async (url: string | URL | Request) => {
			const href = String(url);
			urls.push(href);
			if (href.includes("/accounts/by-riot-id/")) {
				return jsonResponse(account);
			}
			if (href.includes("/active-games/")) {
				return new Response(null, { status: 404 });
			}
			if (href.includes("/ids")) {
				return jsonResponse([]);
			}
			if (href.includes("/league/")) {
				return jsonResponse([]);
			}
			return new Response(null, { status: 500 });
		});
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			players: [{ riotId: "Hide#NA1", platform: "na1" }],
		});
		await service.pollOnce();
		expect(urls.some((u) => u.includes("/accounts/by-riot-id/Hide/NA1"))).toBe(
			true,
		);
		expect(urls.some((u) => u.includes("/active-games/by-summoner/p1"))).toBe(
			true,
		);
		expect(service.getPollState("p1")?.gameName).toBe("Hide");
	});

	test("startPoller needs a key and an account source", () => {
		const setIntervalFn = mock(
			() => 1 as unknown as ReturnType<typeof setInterval>,
		);
		const noKey = new RiotGamesService(null, undefined, {
			players: [PLAYER],
			setInterval: setIntervalFn as typeof setInterval,
		});
		noKey.startPoller();
		expect(setIntervalFn).not.toHaveBeenCalled();

		const noPlayers = new RiotGamesService("key", undefined, {
			players: [],
			setInterval: setIntervalFn as typeof setInterval,
		});
		noPlayers.startPoller();
		expect(setIntervalFn).not.toHaveBeenCalled();

		const linkedAccounts = new RiotGamesService("key", undefined, {
			players: [],
			userLinks: { listAll: mock(async () => []) } as never,
			setInterval: setIntervalFn as typeof setInterval,
			clearInterval: mock(() => undefined) as typeof clearInterval,
		});
		linkedAccounts.startPoller();
		expect(setIntervalFn).toHaveBeenCalledTimes(1);
		linkedAccounts.stopPoller();
	});

	test("pollOnce emits update, stores snapshot, records rank history", async () => {
		const account = { puuid: "p1", gameName: "Hide", tagLine: "NA1" };
		const match = {
			metadata: { matchId: "NA1_1", participants: ["p1"] },
			info: {
				gameCreation: 1000,
				gameDuration: 1800,
				queueId: 420,
				participants: [participant()],
			},
		};
		const league = [
			{
				queueType: "RANKED_SOLO_5x5",
				tier: "GOLD",
				rank: "II",
				leaguePoints: 50,
				wins: 10,
				losses: 8,
			},
		];
		const fetcher = mock(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("/accounts/by-riot-id/")) {
				return jsonResponse(account);
			}
			if (href.includes("/active-games/")) {
				return new Response(null, { status: 404 });
			}
			if (href.includes("/ids")) {
				return jsonResponse(["NA1_1"]);
			}
			if (href.includes("/matches/NA1_1")) {
				return jsonResponse(match);
			}
			if (href.includes("/league/")) {
				return jsonResponse(league);
			}
			return new Response(null, { status: 500 });
		});

		const recordIfChanged = mock(async () => null);
		const listByPuuid = mock(async () => []);
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			players: [PLAYER],
			rankHistory: { listByPuuid, recordIfChanged } as never,
		});

		const updates: import("./RiotGamesService").RiotPlayerPollState[] = [];
		service.on("update", (state) => {
			updates.push(state);
		});

		await service.pollOnce();

		expect(updates).toHaveLength(1);
		expect(service.getPollState("p1")).toEqual(updates[0] ?? null);
		expect(service.getAllPollStates()).toEqual(updates);
		expect(recordIfChanged).toHaveBeenCalledWith(
			"p1",
			{
				tier: "GOLD",
				rank: "II",
				leaguePoints: 50,
				wins: 10,
				losses: 8,
			},
			expect.any(Date),
		);
		expect(updates[0]).toMatchObject({
			puuid: "p1",
			username: "Hide#NA1",
			currentRank: {
				tier: "GOLD",
				rank: "II",
				leaguePoints: 50,
				wins: 10,
				losses: 8,
			},
			inProgress: null,
			mostRecentEnded: {
				matchId: "NA1_1",
				kills: 5,
				deaths: 2,
				assists: 10,
				championId: 64,
				rankBefore: null,
			},
		});
	});

	test("second poll with new match sets rankBefore; seeds from DB history", async () => {
		const account = { puuid: "p1", gameName: "Hide", tagLine: "NA1" };
		let matchId = "NA1_1";
		let lp = 50;
		const fetcher = mock(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("/accounts/by-riot-id/")) {
				return jsonResponse(account);
			}
			if (href.includes("/active-games/")) {
				return new Response(null, { status: 404 });
			}
			if (href.includes("/ids")) {
				return jsonResponse([matchId]);
			}
			if (href.includes("/matches/")) {
				return jsonResponse({
					metadata: { matchId, participants: ["p1"] },
					info: {
						gameCreation: 1000,
						gameDuration: 1800,
						queueId: 420,
						participants: [participant({ kills: 1, deaths: 1, assists: 1 })],
					},
				});
			}
			if (href.includes("/league/")) {
				return jsonResponse([
					{
						queueType: "RANKED_SOLO_5x5",
						tier: "GOLD",
						rank: "II",
						leaguePoints: lp,
						wins: 10,
						losses: 8,
					},
				]);
			}
			return new Response(null, { status: 500 });
		});

		const seeded: RiotRank = {
			tier: "GOLD",
			rank: "II",
			leaguePoints: 40,
			wins: 9,
			losses: 8,
		};
		const listByPuuid = mock(async () => [
			{
				puuid: "p1",
				...seeded,
				detectedAt: new Date(),
			},
		]);
		const recordIfChanged = mock(async () => null);

		let now = 1_000;
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			players: [PLAYER],
			now: () => now,
			rankHistory: { listByPuuid, recordIfChanged } as never,
		});

		const updates: Array<{
			mostRecentEnded: { rankBefore: unknown; rankAfter: unknown } | null;
		}> = [];
		service.on("update", (state) => {
			updates.push(state);
		});

		await service.pollOnce();
		expect(updates[0]?.mostRecentEnded?.rankBefore).toEqual(seeded);

		matchId = "NA1_2";
		lp = 68;
		// past league cache TTL so rank after new match is fresh
		now += 60_000 + 1;
		await service.pollOnce();

		expect(updates).toHaveLength(2);
		expect(updates[1]?.mostRecentEnded?.rankBefore).toEqual({
			tier: "GOLD",
			rank: "II",
			leaguePoints: 50,
			wins: 10,
			losses: 8,
		});
		expect(updates[1]?.mostRecentEnded?.rankAfter).toEqual({
			tier: "GOLD",
			rank: "II",
			leaguePoints: 68,
			wins: 10,
			losses: 8,
		});
	});

	test("getRankHistory delegates to repository", async () => {
		const listByPuuid = mock(async () => [
			{
				puuid: "p1",
				tier: "GOLD",
				rank: "I",
				leaguePoints: 1,
				wins: 1,
				losses: 0,
				detectedAt: new Date("2020-01-01"),
			},
		]);
		const service = new RiotGamesService("key", undefined, {
			rankHistory: {
				listByPuuid,
				recordIfChanged: mock(async () => null),
			} as never,
		});
		expect(await service.getRankHistory("p1")).toHaveLength(1);
		expect(listByPuuid).toHaveBeenCalledWith("p1");
	});

	test("sync backfills once from wol.gg then fetches unknown matches only", async () => {
		const fullMatch = {
			metadata: { matchId: "NA1_new", participants: ["p1", "p2"] },
			info: {
				gameCreation: 1_700_000_000_000,
				gameDuration: 1900,
				queueId: 420,
				participants: [
					participant({ puuid: "p1" }),
					participant({ puuid: "p2", championId: 1 }),
				],
			},
		};

		const matchDetailCalls: string[] = [];
		const matchIdCalls: string[] = [];
		const fetcher = mock(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("/accounts/by-riot-id/")) {
				return jsonResponse({
					puuid: "p1",
					gameName: "Hide",
					tagLine: "NA1",
				});
			}
			if (href.includes("/active-games/")) {
				return new Response(null, { status: 404 });
			}
			if (href.includes("/ids")) {
				matchIdCalls.push(href);
				if (href.includes("startTime=")) {
					return jsonResponse(["NA1_new", "NA1_known"]);
				}
				return jsonResponse(["NA1_new"]);
			}
			if (href.includes("/matches/")) {
				matchDetailCalls.push(href);
				return jsonResponse(fullMatch);
			}
			if (href.includes("/league/")) {
				return jsonResponse([]);
			}
			return new Response(null, { status: 500 });
		});

		const setBackfill = mock(async () => undefined);
		const touchSynced = mock(async () => undefined);
		const getSync = mock(
			async () =>
				null as null | {
					puuid: string;
					lastSyncedAt: Date;
					backfilled: boolean;
					backfillSeconds: number;
					backfillAsOf: Date | null;
				},
		);
		const existingMatchIds = mock(async (ids: string[]) => {
			const set = new Set<string>();
			if (ids.includes("NA1_known")) {
				set.add("NA1_known");
			}
			return set;
		});
		const insertedMatches: Array<{ metadata: { matchId: string } }> = [];
		const insertMatchWithParticipants = mock(
			async (match: { metadata: { matchId: string } }) => {
				insertedMatches.push(match);
			},
		);

		let now = 1_700_100_000_000;
		const listAllLinks = mock(async () => [
			{
				userId: "u1",
				puuid: "p1",
				platform: "euw1" as const,
				gameName: "Hide",
				tagLine: "NA1",
				linkedAt: new Date(),
			},
		]);
		const getByPuuid = mock(async () => ({
			userId: "u1",
			puuid: "p1",
			platform: "na1" as const,
			gameName: "Hide",
			tagLine: "NA1",
			linkedAt: new Date(),
		}));
		const fetchPlaytimeSeconds = mock(async () => 63_266 * 60);
		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			players: [PLAYER],
			now: () => now,
			matchSync: {
				get: getSync,
				setBackfill,
				touchSynced,
			} as never,
			matches: {
				existingMatchIds,
				insertMatchWithParticipants,
			} as never,
			userLinks: { listAll: listAllLinks, getByPuuid } as never,
			wol: { fetchPlaytimeSeconds } as never,
		});

		// poll 1: wol.gg backfill
		await service.pollOnce();
		expect(setBackfill).toHaveBeenCalledTimes(1);
		expect(fetchPlaytimeSeconds).toHaveBeenCalledWith("na1", "Hide", "NA1");
		const backfillArgs = setBackfill.mock.calls[0] as unknown as [
			string,
			number,
			Date,
		];
		expect(backfillArgs[0]).toBe("p1");
		expect(backfillArgs[1]).toBe(63_266 * 60);
		expect(backfillArgs[2]).toEqual(new Date(1_700_100_000_000));
		expect(matchIdCalls.some((url) => url.includes("queue="))).toBe(false);
		expect(insertMatchWithParticipants).not.toHaveBeenCalled();

		// poll 2: incremental
		const previousSyncedAt = new Date(now);
		getSync.mockImplementation(async () => ({
			puuid: "p1",
			lastSyncedAt: previousSyncedAt,
			backfilled: true,
			backfillSeconds: 63_266 * 60,
			backfillAsOf: previousSyncedAt,
		}));
		now += 60_000;
		matchDetailCalls.length = 0;
		matchIdCalls.length = 0;
		await service.pollOnce();

		expect(setBackfill).toHaveBeenCalledTimes(1);
		expect(fetchPlaytimeSeconds).toHaveBeenCalledTimes(1);
		expect(existingMatchIds).toHaveBeenCalled();
		expect(insertedMatches).toHaveLength(1);
		expect(insertedMatches[0]?.metadata.matchId).toBe("NA1_new");
		expect(touchSynced).toHaveBeenCalledTimes(1);
		expect(
			matchIdCalls.some(
				(url) =>
					url.includes("startTime=1700013600") &&
					url.includes("endTime=1700100060"),
			),
		).toBe(true);
		// ensurePlaytimeBackfill + syncPlayerMatches each call get once per poll
		expect(getSync).toHaveBeenCalledTimes(4);
		expect(
			matchDetailCalls.filter((u) => u.includes("NA1_known")),
		).toHaveLength(0);
	});

	test("syncs a linked account without configured players", async () => {
		const listAll = mock(async () => [
			{
				userId: "u1",
				puuid: "linked-puuid",
				platform: "euw1" as const,
				gameName: "Linked",
				tagLine: "EUW",
				linkedAt: new Date(),
			},
		]);
		const getByPuuid = mock(async () => ({
			userId: "u1",
			puuid: "linked-puuid",
			platform: "euw1" as const,
			gameName: "Linked",
			tagLine: "EUW",
			linkedAt: new Date(),
		}));
		const setBackfill = mock(async () => undefined);
		const fetchPlaytimeSeconds = mock(async () => 3600);
		const service = new RiotGamesService("key", undefined, {
			fetch: mock(async () => new Response(null, { status: 500 })),
			players: [],
			now: () => 1_700_100_000_000,
			userLinks: { listAll, getByPuuid } as never,
			matchSync: {
				get: mock(async () => null),
				setBackfill,
			} as never,
			matches: {} as never,
			wol: { fetchPlaytimeSeconds } as never,
		});

		await service.pollOnce();

		expect(listAll).toHaveBeenCalledTimes(1);
		expect(fetchPlaytimeSeconds).toHaveBeenCalledWith("euw1", "Linked", "EUW");
		expect(setBackfill).toHaveBeenCalledWith(
			"linked-puuid",
			3600,
			new Date(1_700_100_000_000),
		);
	});

	test("skips backfill mark when wol.gg returns null", async () => {
		const setBackfill = mock(async () => undefined);
		const service = new RiotGamesService("key", undefined, {
			fetch: mock(async (url: string | URL | Request) => {
				if (String(url).includes("/accounts/by-riot-id/")) {
					return jsonResponse({
						puuid: "p1",
						gameName: "Hide",
						tagLine: "NA1",
					});
				}
				if (String(url).includes("/active-games/")) {
					return new Response(null, { status: 404 });
				}
				if (String(url).includes("/league/")) {
					return jsonResponse([]);
				}
				if (String(url).includes("/ids")) {
					return jsonResponse([]);
				}
				return new Response(null, { status: 500 });
			}),
			players: [PLAYER],
			now: () => 1_700_100_000_000,
			userLinks: {
				listAll: mock(async () => []),
				getByPuuid: mock(async () => null),
			} as never,
			matchSync: {
				get: mock(async () => null),
				setBackfill,
			} as never,
			matches: {} as never,
			wol: { fetchPlaytimeSeconds: mock(async () => null) } as never,
		});

		await service.pollOnce();
		expect(setBackfill).not.toHaveBeenCalled();
	});

	test("ensurePlaytimeBackfill is idempotent when already backfilled", async () => {
		const setBackfill = mock(async () => undefined);
		const fetchPlaytimeSeconds = mock(async () => 999);
		const service = new RiotGamesService("key", undefined, {
			now: () => 1_700_100_000_000,
			userLinks: {
				getByPuuid: mock(async () => ({
					userId: "u1",
					puuid: "p1",
					platform: "na1" as const,
					gameName: "Hide",
					tagLine: "NA1",
					linkedAt: new Date(),
				})),
			} as never,
			matchSync: {
				get: mock(async () => ({
					puuid: "p1",
					lastSyncedAt: new Date(),
					backfilled: true,
					backfillSeconds: 3600,
					backfillAsOf: new Date(),
				})),
				setBackfill,
			} as never,
			wol: { fetchPlaytimeSeconds } as never,
		});

		await service.ensurePlaytimeBackfill({ puuid: "p1", platform: "na1" });
		expect(fetchPlaytimeSeconds).not.toHaveBeenCalled();
		expect(setBackfill).not.toHaveBeenCalled();
	});

	test("ensurePlaytimeBackfill writes when cold", async () => {
		const setBackfill = mock(async () => undefined);
		const fetchPlaytimeSeconds = mock(async () => 7200);
		const service = new RiotGamesService("key", undefined, {
			now: () => 1_700_100_000_000,
			userLinks: {
				getByPuuid: mock(async () => ({
					userId: "u1",
					puuid: "p1",
					platform: "na1" as const,
					gameName: "Hide",
					tagLine: "NA1",
					linkedAt: new Date(),
				})),
			} as never,
			matchSync: {
				get: mock(async () => null),
				setBackfill,
			} as never,
			wol: { fetchPlaytimeSeconds } as never,
		});

		await service.ensurePlaytimeBackfill({ puuid: "p1", platform: "na1" });
		expect(fetchPlaytimeSeconds).toHaveBeenCalledWith("na1", "Hide", "NA1");
		expect(setBackfill).toHaveBeenCalledWith(
			"p1",
			7200,
			new Date(1_700_100_000_000),
		);
	});
});
