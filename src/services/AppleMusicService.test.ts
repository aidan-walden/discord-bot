import { describe, expect, test } from "bun:test";
import type { AppleMusicClient } from "./AppleMusicService";
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

describe("AppleMusicService", () => {
	test("is always available", () => {
		expect(new AppleMusicService(makeClient()).isAvailable()).toBe(true);
	});

	test("resolves a track link and formats artwork", async () => {
		const service = new AppleMusicService(
			makeClient({ fetchSong: async () => fakeSong() }),
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
	});

	test("resolves an album link", async () => {
		const service = new AppleMusicService(
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
		const service = new AppleMusicService(
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
		const service = new AppleMusicService(
			makeClient({ fetchUpc: async () => fakeAlbum() }),
		);
		const item = await service.findByUpc("886443919266");
		expect(item).toMatchObject({ kind: "album", upc: "886443919266" });
	});

	test("falls back to a song text search", async () => {
		let requested: { term: string; types?: string } | undefined;
		const service = new AppleMusicService(
			makeClient({
				search: async (term, options) => {
					requested = { term, types: options?.types };
					return { songs: [fakeSong()] };
				},
			}),
		);

		const item = await service.searchText("track", "Daft Punk Get Lucky");
		expect(requested).toEqual({ term: "Daft Punk Get Lucky", types: "songs" });
		expect(item).toMatchObject({ title: "Get Lucky" });
	});

	test("returns null when a lookup finds nothing", async () => {
		const service = new AppleMusicService(makeClient());
		expect(await service.findByIsrc("missing")).toBeNull();
		expect(
			await service.resolve({ platform: "apple", kind: "track", id: "x" }),
		).toBeNull();
	});
});
