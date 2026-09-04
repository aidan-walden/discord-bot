import { describe, expect, test } from "bun:test";
import type {
	AppleMusicClient,
	AppleMusicTokenSource,
} from "./AppleMusicService";
import AppleMusicService from "./AppleMusicService";

function fakeSong(overrides: Record<string, unknown> = {}) {
	return {
		id: "song1",
		type: "songs",
		attributes: {
			name: "Get Lucky",
			artistName: "Daft Punk",
			url: "https://music.apple.com/us/album/get-lucky/1?i=2",
			isrc: "USQX91300108",
			artwork: { url: "https://img/{w}x{h}.jpg", width: 2000, height: 2000 },
		},
		...overrides,
	};
}

function fakeAlbum(overrides: Record<string, unknown> = {}) {
	return {
		id: "album1",
		type: "albums",
		attributes: {
			name: "Random Access Memories",
			artistName: "Daft Punk",
			url: "https://music.apple.com/us/album/ram/1",
			upc: "886443919266",
			artwork: { url: "https://img/{w}x{h}.jpg", width: 2000, height: 2000 },
		},
		...overrides,
	};
}

function makeClient(
	overrides: Partial<AppleMusicClient> = {},
): AppleMusicClient {
	return {
		fetchSong: async () => null,
		fetchAlbum: async () => null,
		fetchIsrc: async () => null,
		fetchUpc: async () => null,
		search: async () => null,
		formatArtworkUrl: (artwork, options) =>
			artwork.url
				.replace("{w}", String(options?.width ?? artwork.width))
				.replace("{h}", String(options?.height ?? artwork.height)),
		...overrides,
	} as AppleMusicClient;
}

function makeTokenSource(
	fetchToken: () => Promise<string> = async () => "dummy-token",
): AppleMusicTokenSource {
	return { fetch: fetchToken };
}

function makeService(
	client: AppleMusicClient,
	tokenSource: AppleMusicTokenSource = makeTokenSource(),
): AppleMusicService {
	return new AppleMusicService(client, tokenSource);
}

describe("AppleMusicService", () => {
	test("resolves a track link and formats artwork", async () => {
		let requestedToken: string | undefined;
		const service = makeService(
			makeClient({
				fetchSong: async (_id, options) => {
					requestedToken = options?.token;
					return fakeSong();
				},
			}),
		);

		const item = await service.resolve({
			platform: "apple",
			kind: "track",
			id: "song1",
		});

		expect(item).toEqual({
			platform: "apple",
			kind: "track",
			title: "Get Lucky",
			artist: "Daft Punk",
			isrc: "USQX91300108",
			url: "https://music.apple.com/us/album/get-lucky/1?i=2",
			artworkUrl: "https://img/512x512.jpg",
		});
		expect(requestedToken).toBe("dummy-token");
	});

	test("resolves an album link", async () => {
		const service = makeService(
			makeClient({ fetchAlbum: async () => fakeAlbum() }),
		);

		const item = await service.resolve({
			platform: "apple",
			kind: "album",
			id: "album1",
		});

		expect(item).toMatchObject({
			kind: "album",
			title: "Random Access Memories",
			upc: "886443919266",
		});
	});

	test("finds a song by ISRC", async () => {
		let requested: string | undefined;
		const service = makeService(
			makeClient({
				fetchIsrc: async (isrc) => {
					requested = isrc;
					return fakeSong();
				},
			}),
		);

		const item = await service.findByIsrc("USQX91300108");
		expect(requested).toBe("USQX91300108");
		expect(item).toMatchObject({ kind: "track", isrc: "USQX91300108" });
	});

	test("finds an album by UPC", async () => {
		const service = makeService(
			makeClient({ fetchUpc: async () => fakeAlbum() }),
		);
		const item = await service.findByUpc("886443919266");
		expect(item).toMatchObject({ kind: "album", upc: "886443919266" });
	});

	test("falls back to a song text search", async () => {
		let requested: { term: string; types?: string; token?: string } | undefined;
		const service = makeService(
			makeClient({
				search: async (term, options) => {
					requested = {
						term,
						types: options?.types,
						token: options?.token,
					};
					return { songs: [fakeSong()] };
				},
			}),
		);

		const item = await service.searchText("track", "Daft Punk Get Lucky");
		expect(requested).toEqual({
			term: "Daft Punk Get Lucky",
			types: "songs",
			token: "dummy-token",
		});
		expect(item).toMatchObject({ title: "Get Lucky" });
	});

	test("returns null when a lookup finds nothing", async () => {
		const service = makeService(makeClient());
		expect(await service.findByIsrc("missing")).toBeNull();
		expect(
			await service.resolve({ platform: "apple", kind: "track", id: "x" }),
		).toBeNull();
	});

	test("is unavailable until a token is fetched", async () => {
		const service = makeService(makeClient());

		expect(service.isAvailable()).toBe(false);
		expect(await service.fetchToken()).toBe(true);
		expect(service.isAvailable()).toBe(true);
	});

	test("becomes unavailable when token fetching fails", async () => {
		let shouldFail = false;
		const service = makeService(
			makeClient(),
			makeTokenSource(async () => {
				if (shouldFail) {
					throw new Error("scrape failed");
				}
				return "dummy-token";
			}),
		);

		expect(await service.fetchToken()).toBe(true);
		expect(service.isAvailable()).toBe(true);
		shouldFail = true;
		expect(await service.fetchToken()).toBe(false);
		expect(service.isAvailable()).toBe(false);
	});

	test("fetches a token before calling a catalog method", async () => {
		const calls: string[] = [];
		const service = makeService(
			makeClient({
				fetchSong: async () => {
					calls.push("catalog");
					return fakeSong();
				},
			}),
			makeTokenSource(async () => {
				calls.push("token");
				return "dummy-token";
			}),
		);

		await service.resolve({ platform: "apple", kind: "track", id: "song1" });
		expect(calls).toEqual(["token", "catalog"]);
	});

	test("does not call the catalog client when token fetching fails", async () => {
		let catalogCalled = false;
		const service = makeService(
			makeClient({
				fetchSong: async () => {
					catalogCalled = true;
					return fakeSong();
				},
			}),
			makeTokenSource(async () => {
				throw new Error("scrape failed");
			}),
		);

		expect(
			await service.resolve({ platform: "apple", kind: "track", id: "song1" }),
		).toBeNull();
		expect(catalogCalled).toBe(false);
		expect(service.isAvailable()).toBe(false);
	});

	test("refreshes the token once after an unauthorized response", async () => {
		let tokenFetches = 0;
		let catalogCalls = 0;
		const requestedTokens: string[] = [];
		const unauthorized = {
			errors: [{ status: "401" }],
		} as unknown as Awaited<ReturnType<AppleMusicClient["fetchSong"]>>;
		const service = makeService(
			makeClient({
				fetchSong: async (_id, options) => {
					requestedTokens.push(options?.token ?? "");
					catalogCalls += 1;
					return catalogCalls === 1 ? unauthorized : fakeSong();
				},
			}),
			makeTokenSource(async () => {
				tokenFetches += 1;
				return tokenFetches === 1 ? "first-token" : "second-token";
			}),
		);

		const item = await service.resolve({
			platform: "apple",
			kind: "track",
			id: "song1",
		});

		expect(item).toMatchObject({ title: "Get Lucky" });
		expect(tokenFetches).toBe(2);
		expect(catalogCalls).toBe(2);
		expect(requestedTokens).toEqual(["first-token", "second-token"]);
	});

	test("clears the token when refreshing after 401 fails", async () => {
		let tokenFetches = 0;
		let catalogCalls = 0;
		const unauthorized = {
			errors: [{ status: 401 }],
		} as unknown as Awaited<ReturnType<AppleMusicClient["fetchSong"]>>;
		const service = makeService(
			makeClient({
				fetchSong: async () => {
					catalogCalls += 1;
					return unauthorized;
				},
			}),
			makeTokenSource(async () => {
				tokenFetches += 1;
				if (tokenFetches > 1) {
					throw new Error("scrape failed");
				}
				return "first-token";
			}),
		);

		expect(
			await service.resolve({
				platform: "apple",
				kind: "track",
				id: "song1",
			}),
		).toBeNull();
		expect(catalogCalls).toBe(1);
		expect(service.isAvailable()).toBe(false);
	});

	test("sets the client token after a successful fetch", async () => {
		let receivedToken: string | undefined;
		const service = makeService(
			makeClient({
				setToken: (token) => {
					receivedToken = token;
				},
			}),
			makeTokenSource(async () => "dummy-token"),
		);

		expect(await service.fetchToken()).toBe(true);
		expect(receivedToken).toBe("dummy-token");
	});
});
