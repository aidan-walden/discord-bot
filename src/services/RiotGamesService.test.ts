import { describe, expect, mock, test } from "bun:test";
import RiotGamesService, {
	platformToRegion,
	RiotGamesError,
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
		expect(await service.getMatchIdsByPuuid("americas", "puuid")).toEqual([]);
		expect(await service.getMatch("americas", "NA1_1")).toBeNull();
		expect(await service.getLeagueEntriesByPuuid("na1", "puuid")).toEqual([]);
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

	test("returns null on 404 for account and match", async () => {
		const fetcher = mock(async () => new Response(null, { status: 404 }));
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });

		expect(await service.getAccountByRiotId("americas", "x", "y")).toBeNull();
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

	test("does not cache match id lists or league entries", async () => {
		const fetcher = mock(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("/ids")) {
				return jsonResponse(["m1"]);
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
		const service = new RiotGamesService("key", undefined, { fetch: fetcher });

		await service.getMatchIdsByPuuid("americas", "p");
		await service.getMatchIdsByPuuid("americas", "p");
		await service.getLeagueEntriesByPuuid("na1", "p");
		await service.getLeagueEntriesByPuuid("na1", "p");
		expect(fetcher).toHaveBeenCalledTimes(4);
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

		await service.getMatchIdsByPuuid("europe", "abc", { start: 5, count: 10 });
		expect(fetcher).toHaveBeenCalledWith(
			"https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/abc/ids?start=5&count=10",
			{ headers: { "X-Riot-Token": "key" } },
		);
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

	test("startPoller is a no-op without key or players", () => {
		const setIntervalFn = mock(
			() => 1 as unknown as ReturnType<typeof setInterval>,
		);
		const noKey = new RiotGamesService(null, undefined, {
			players: [{ gameName: "A", tagLine: "B", platform: "na1" }],
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
	});

	test("pollOnce emits update with rank and ended game", async () => {
		const account = { puuid: "p1", gameName: "Hide", tagLine: "NA1" };
		const match = {
			metadata: { matchId: "NA1_1", participants: ["p1"] },
			info: {
				gameCreation: 1000,
				gameDuration: 1800,
				queueId: 420,
				participants: [
					{
						puuid: "p1",
						championId: 64,
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
					},
				],
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

		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			players: [{ gameName: "Hide", tagLine: "NA1", platform: "na1" }],
		});

		const updates: unknown[] = [];
		service.on("update", (state) => {
			updates.push(state);
		});

		await service.pollOnce();

		expect(updates).toHaveLength(1);
		expect(updates[0]).toEqual({
			username: "Hide#NA1",
			gameName: "Hide",
			tagLine: "NA1",
			platform: "na1",
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
				win: true,
				queueId: 420,
				gameCreation: 1000,
				gameDuration: 1800,
				rankBefore: null,
				rankAfter: {
					tier: "GOLD",
					rank: "II",
					leaguePoints: 50,
					wins: 10,
					losses: 8,
				},
			},
		});
	});

	test("second poll with new match sets rankBefore from prior rank", async () => {
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
						participants: [
							{
								puuid: "p1",
								championId: 1,
								champLevel: 18,
								kills: 1,
								deaths: 1,
								assists: 1,
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
							},
						],
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

		const service = new RiotGamesService("key", undefined, {
			fetch: fetcher,
			players: [{ gameName: "Hide", tagLine: "NA1", platform: "na1" }],
		});

		const updates: Array<{
			mostRecentEnded: { rankBefore: unknown; rankAfter: unknown } | null;
		}> = [];
		service.on("update", (state) => {
			updates.push(state);
		});

		await service.pollOnce();
		matchId = "NA1_2";
		lp = 68;
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
});
