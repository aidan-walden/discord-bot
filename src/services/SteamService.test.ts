import { describe, expect, mock, test } from "bun:test";
import SteamService, { SteamLibraryUnavailableError } from "./SteamService";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function ownedGamesResponse(
	games: Array<{ appid?: unknown; name?: unknown }>,
	gameCount?: number,
) {
	return {
		response: {
			game_count: gameCount ?? games.length,
			games,
		},
	};
}

function storeDetails(
	appid: number,
	options: {
		success?: boolean;
		type?: string;
		categories?: Array<{ id: number }>;
		omitData?: boolean;
	} = {},
) {
	const success = options.success ?? true;
	if (!success) {
		return { [String(appid)]: { success: false } };
	}
	if (options.omitData) {
		return { [String(appid)]: { success: true } };
	}
	return {
		[String(appid)]: {
			success: true,
			data: {
				type: options.type ?? "game",
				categories: options.categories ?? [{ id: 38 }],
			},
		},
	};
}

function ownedUrl(steamId: string): string {
	const url = new URL(
		"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
	);
	url.searchParams.set("key", "steam-key");
	url.searchParams.set("steamid", steamId);
	url.searchParams.set("include_appinfo", "true");
	url.searchParams.set("include_played_free_games", "true");
	return url.toString();
}

function storeUrl(appid: number): string {
	const url = new URL("https://store.steampowered.com/api/appdetails");
	url.searchParams.set("appids", String(appid));
	url.searchParams.set("filters", "basic,categories");
	return url.toString();
}

describe("SteamService", () => {
	test("is unavailable without key and throws when called", async () => {
		const fetcher = mock(async () => jsonResponse({}));
		const service = new SteamService(null, undefined, { fetch: fetcher });
		const blank = new SteamService("   ", undefined, { fetch: fetcher });

		expect(service.isAvailable()).toBe(false);
		expect(blank.isAvailable()).toBe(false);
		await expect(service.findRandomCommonOnlineCoopGame(["1"])).rejects.toThrow(
			"Steam API is not configured",
		);
		expect(fetcher).not.toHaveBeenCalled();
	});

	test("requests each unique SteamID once and intersects libraries", async () => {
		const fetcher = mock(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("GetOwnedGames")) {
				const steamId = new URL(url).searchParams.get("steamid");
				if (steamId === "s1" || steamId === "s1-dup") {
					return jsonResponse(
						ownedGamesResponse([
							{ appid: 10, name: "Alpha" },
							{ appid: 20, name: "Beta" },
							{ appid: 10, name: "Alpha Dup" },
							{ appid: -1, name: "bad" },
							{ appid: 30, name: "   " },
							{ appid: 40 },
						]),
					);
				}
				return jsonResponse(
					ownedGamesResponse([
						{ appid: 20, name: "Beta" },
						{ appid: 50, name: "Gamma" },
					]),
				);
			}
			return jsonResponse(storeDetails(20));
		});

		const service = new SteamService(" steam-key ", undefined, {
			fetch: fetcher,
			randomInt: () => 0,
		});

		const game = await service.findRandomCommonOnlineCoopGame([
			"s1",
			"s2",
			"s1",
		]);

		expect(game).toEqual({ appid: 20, name: "Beta" });
		const ownedUrls = fetcher.mock.calls
			.map((call) => String(call[0]))
			.filter((url) => url.includes("GetOwnedGames"))
			.sort();
		expect(ownedUrls).toEqual([ownedUrl("s1"), ownedUrl("s2")].sort());
	});

	test("shuffles with injected randomInt and returns first online co-op game", async () => {
		const storeCalls: number[] = [];
		const fetcher = mock(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("GetOwnedGames")) {
				return jsonResponse(
					ownedGamesResponse([
						{ appid: 1, name: "One" },
						{ appid: 2, name: "Two" },
						{ appid: 3, name: "Three" },
					]),
				);
			}
			const appid = Number(new URL(url).searchParams.get("appids"));
			storeCalls.push(appid);
			if (appid === 3) {
				return jsonResponse(storeDetails(3, { categories: [{ id: 38 }] }));
			}
			return jsonResponse(storeDetails(appid, { categories: [{ id: 2 }] }));
		});

		// Fisher-Yates on [1,2,3]: j=0 then j=1 yields [3,2,1], so 3 is first.
		const answers = [0, 1];
		const randomInt = mock((maxExclusive: number) => {
			expect(maxExclusive).toBeGreaterThan(0);
			const value = answers.shift() ?? 0;
			expect(value).toBeLessThan(maxExclusive);
			return value;
		});
		const service = new SteamService("steam-key", undefined, {
			fetch: fetcher,
			randomInt,
		});

		const game = await service.findRandomCommonOnlineCoopGame(["s1", "s2"]);
		expect(game).toEqual({ appid: 3, name: "Three" });
		expect(storeCalls[0]).toBe(3);
		expect(randomInt).toHaveBeenCalled();
	});

	test("skips online-co-op-tagged non-game and success-false candidates", async () => {
		const fetcher = mock(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("GetOwnedGames")) {
				return jsonResponse(
					ownedGamesResponse([
						{ appid: 1, name: "DLC" },
						{ appid: 2, name: "Missing" },
						{ appid: 3, name: "Good" },
					]),
				);
			}
			const appid = Number(new URL(url).searchParams.get("appids"));
			if (appid === 1) {
				return jsonResponse(
					storeDetails(1, { type: "dlc", categories: [{ id: 1 }] }),
				);
			}
			if (appid === 2) {
				return jsonResponse(storeDetails(2, { success: false }));
			}
			return jsonResponse(storeDetails(3));
		});

		const service = new SteamService("steam-key", undefined, {
			fetch: fetcher,
			randomInt: () => 0,
		});
		expect(await service.findRandomCommonOnlineCoopGame(["a", "b"])).toEqual({
			appid: 3,
			name: "Good",
		});
	});

	test("skips success-true storefront entries with malformed data", async () => {
		const fetcher = mock(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("GetOwnedGames")) {
				return jsonResponse(
					ownedGamesResponse([
						{ appid: 1, name: "Broken" },
						{ appid: 2, name: "Good" },
					]),
				);
			}
			const appid = Number(new URL(url).searchParams.get("appids"));
			if (appid === 1) {
				return jsonResponse(storeDetails(1, { omitData: true }));
			}
			return jsonResponse(storeDetails(2));
		});

		const service = new SteamService("steam-key", undefined, {
			fetch: fetcher,
			randomInt: () => 0,
		});
		expect(await service.findRandomCommonOnlineCoopGame(["a", "b"])).toEqual({
			appid: 2,
			name: "Good",
		});
	});

	test("returns null for empty common set without storefront calls", async () => {
		const fetcher = mock(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("GetOwnedGames")) {
				const steamId = new URL(url).searchParams.get("steamid");
				if (steamId === "a") {
					return jsonResponse(ownedGamesResponse([{ appid: 1, name: "A" }]));
				}
				return jsonResponse(ownedGamesResponse([{ appid: 2, name: "B" }]));
			}
			throw new Error("storefront should not be called");
		});

		const service = new SteamService("steam-key", undefined, {
			fetch: fetcher,
		});
		expect(await service.findRandomCommonOnlineCoopGame(["a", "b"])).toBeNull();
		expect(
			fetcher.mock.calls.some((call) =>
				String(call[0]).includes("store.steampowered.com"),
			),
		).toBe(false);
	});

	test("treats game_count 0 as empty library", async () => {
		const fetcher = mock(async () =>
			jsonResponse({ response: { game_count: 0 } }),
		);
		const service = new SteamService("steam-key", undefined, {
			fetch: fetcher,
		});
		expect(await service.findRandomCommonOnlineCoopGame(["a", "b"])).toBeNull();
	});

	test("throws SteamLibraryUnavailableError when games missing and game_count is not 0", async () => {
		const fetcher = mock(async () => jsonResponse({ response: {} }));
		const service = new SteamService("steam-key", undefined, {
			fetch: fetcher,
		});

		try {
			await service.findRandomCommonOnlineCoopGame(["private-id"]);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SteamLibraryUnavailableError);
			expect((error as SteamLibraryUnavailableError).steamId).toBe(
				"private-id",
			);
		}
	});

	test("reports credential rejection on owned-games 401 and 403 then throws", async () => {
		for (const status of [401, 403] as const) {
			const recordCredentialRejection = mock(() => undefined);
			const fetcher = mock(async () => new Response(null, { status }));
			const service = new SteamService(
				"steam-key",
				{ recordCredentialRejection },
				{ fetch: fetcher },
			);

			await expect(
				service.findRandomCommonOnlineCoopGame(["s1"]),
			).rejects.toThrow(`Steam owned games returned HTTP ${status}`);
			expect(recordCredentialRejection).toHaveBeenCalledWith("steam");
		}
	});

	test("does not report credential rejection on 429, 500, or network errors", async () => {
		for (const scenario of [
			{ kind: "status", status: 429 },
			{ kind: "status", status: 500 },
			{ kind: "network" },
		] as const) {
			const recordCredentialRejection = mock(() => undefined);
			const fetcher = mock(async () => {
				if (scenario.kind === "network") {
					throw new Error("network down");
				}
				return new Response(null, { status: scenario.status });
			});
			const service = new SteamService(
				"steam-key",
				{ recordCredentialRejection },
				{ fetch: fetcher },
			);

			await expect(
				service.findRandomCommonOnlineCoopGame(["s1"]),
			).rejects.toThrow();
			expect(recordCredentialRejection).not.toHaveBeenCalled();
		}
	});

	test("storefront errors throw without credential reporting", async () => {
		const recordCredentialRejection = mock(() => undefined);
		const fetcher = mock(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes("GetOwnedGames")) {
				return jsonResponse(ownedGamesResponse([{ appid: 1, name: "Game" }]));
			}
			return new Response(null, { status: 503 });
		});
		const service = new SteamService(
			"steam-key",
			{ recordCredentialRejection },
			{ fetch: fetcher, randomInt: () => 0 },
		);

		await expect(
			service.findRandomCommonOnlineCoopGame(["a", "b"]),
		).rejects.toThrow("Steam storefront returned HTTP 503");
		expect(recordCredentialRejection).not.toHaveBeenCalled();
		expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(storeUrl(1));
	});
});
