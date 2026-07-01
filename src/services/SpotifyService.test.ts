import { describe, expect, test } from "bun:test";
import type { SpotifyApi } from "@spotify/web-api-ts-sdk";
import SpotifyService from "./SpotifyService";

function fakeTrack(overrides: Record<string, unknown> = {}) {
	return {
		name: "Get Lucky",
		artists: [{ name: "Daft Punk" }, { name: "Pharrell Williams" }],
		external_ids: { isrc: "USQX91300108" },
		external_urls: { spotify: "https://open.spotify.com/track/track1" },
		album: { images: [{ url: "https://img/track.jpg" }] },
		...overrides,
	};
}

function fakeAlbum(overrides: Record<string, unknown> = {}) {
	return {
		name: "Random Access Memories",
		artists: [{ name: "Daft Punk" }],
		external_ids: { upc: "886443919266" },
		external_urls: { spotify: "https://open.spotify.com/album/album1" },
		images: [{ url: "https://img/album.jpg" }],
		...overrides,
	};
}

interface FakeCalls {
	trackGet: string[];
	albumGet: string[];
	search: Array<{ query: string; types: readonly string[] }>;
}

function makeClient(responses: {
	track?: unknown;
	album?: unknown;
	searchTracks?: unknown[];
	searchAlbums?: unknown[];
}): { client: SpotifyApi; calls: FakeCalls } {
	const calls: FakeCalls = { trackGet: [], albumGet: [], search: [] };
	const client = {
		tracks: {
			get: async (id: string) => {
				calls.trackGet.push(id);
				return responses.track;
			},
		},
		albums: {
			get: async (id: string) => {
				calls.albumGet.push(id);
				return responses.album;
			},
		},
		search: async (query: string, types: readonly string[]) => {
			calls.search.push({ query, types });
			return {
				tracks: { items: responses.searchTracks ?? [] },
				albums: { items: responses.searchAlbums ?? [] },
			};
		},
	} as unknown as SpotifyApi;
	return { client, calls };
}

describe("SpotifyService", () => {
	test("is unavailable and resolves nothing without a client", async () => {
		const service = new SpotifyService(null);
		expect(service.isAvailable()).toBe(false);
		expect(
			await service.resolve({ platform: "spotify", kind: "track", id: "x" }),
		).toBeNull();
		expect(await service.findByIsrc("x")).toBeNull();
	});

	test("resolves a track link into a normalized item", async () => {
		const { client, calls } = makeClient({ track: fakeTrack() });
		const service = new SpotifyService(client);

		const item = await service.resolve({
			platform: "spotify",
			kind: "track",
			id: "track1",
		});

		expect(calls.trackGet).toEqual(["track1"]);
		expect(item).toEqual({
			platform: "spotify",
			kind: "track",
			title: "Get Lucky",
			artist: "Daft Punk, Pharrell Williams",
			isrc: "USQX91300108",
			url: "https://open.spotify.com/track/track1",
			artworkUrl: "https://img/track.jpg",
		});
	});

	test("resolves an album link into a normalized item", async () => {
		const { client } = makeClient({ album: fakeAlbum() });
		const service = new SpotifyService(client);

		const item = await service.resolve({
			platform: "spotify",
			kind: "album",
			id: "album1",
		});

		expect(item).toMatchObject({
			kind: "album",
			title: "Random Access Memories",
			artist: "Daft Punk",
			upc: "886443919266",
		});
	});

	test("finds a track by ISRC via search", async () => {
		const { client, calls } = makeClient({ searchTracks: [fakeTrack()] });
		const service = new SpotifyService(client);

		const item = await service.findByIsrc("USQX91300108");

		expect(calls.search[0]).toEqual({
			query: "isrc:USQX91300108",
			types: ["track"],
		});
		expect(item).toMatchObject({ kind: "track", isrc: "USQX91300108" });
	});

	test("finds an album by UPC via search", async () => {
		const { client, calls } = makeClient({ searchAlbums: [fakeAlbum()] });
		const service = new SpotifyService(client);

		const item = await service.findByUpc("886443919266");

		expect(calls.search[0]).toEqual({
			query: "upc:886443919266",
			types: ["album"],
		});
		expect(item).toMatchObject({ kind: "album", upc: "886443919266" });
	});

	test("returns null when a search yields no results", async () => {
		const { client } = makeClient({ searchTracks: [] });
		const service = new SpotifyService(client);
		expect(await service.findByIsrc("missing")).toBeNull();
	});

	test("falls back to text search", async () => {
		const { client, calls } = makeClient({ searchTracks: [fakeTrack()] });
		const service = new SpotifyService(client);

		const item = await service.searchText("track", "Daft Punk Get Lucky");

		expect(calls.search[0]).toEqual({
			query: "Daft Punk Get Lucky",
			types: ["track"],
		});
		expect(item).toMatchObject({ title: "Get Lucky" });
	});
});
