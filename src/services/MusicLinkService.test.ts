import { describe, expect, mock, test } from "bun:test";
import type { ParsedMusicLink } from "../helpers/musicLinks";
import MusicLinkService, {
	type MusicLinkMappingStore,
	type MusicProvider,
} from "./MusicLinkService";
import type { MusicItem, MusicPlatform } from "./musicTypes";

/** A configurable fake provider that records how it was queried. */
class FakeProvider implements MusicProvider {
	calls: string[] = [];
	resolvedLinks: ParsedMusicLink[] = [];

	constructor(
		private readonly behavior: {
			available?: boolean;
			resolve?: MusicItem | null;
			resolveResults?: Array<MusicItem | null | Error>;
			byIsrc?: MusicItem | null;
			byUpc?: MusicItem | null;
			text?: MusicItem | null;
		} = {},
	) {}

	private resolveIndex = 0;

	isAvailable(): boolean {
		return this.behavior.available ?? true;
	}

	async resolve(link: ParsedMusicLink): Promise<MusicItem | null> {
		this.calls.push("resolve");
		this.resolvedLinks.push(link);
		if (this.behavior.resolveResults) {
			const result = this.behavior.resolveResults[this.resolveIndex++] ?? null;
			if (result instanceof Error) {
				throw result;
			}
			return result;
		}
		return this.behavior.resolve ?? null;
	}

	async findByIsrc(isrc: string): Promise<MusicItem | null> {
		this.calls.push(`isrc:${isrc}`);
		return this.behavior.byIsrc ?? null;
	}

	async findByUpc(upc: string): Promise<MusicItem | null> {
		this.calls.push(`upc:${upc}`);
		return this.behavior.byUpc ?? null;
	}

	async searchText(_kind: string, query: string): Promise<MusicItem | null> {
		this.calls.push(`text:${query}`);
		return this.behavior.text ?? null;
	}
}

class FakeMappingStore implements MusicLinkMappingStore {
	calls: string[] = [];

	constructor(private readonly mappings = new Map<string, string[]>()) {}

	async findOtherIds(platform: MusicPlatform, id: string): Promise<string[]> {
		this.calls.push(`find:${platform}:${id}`);
		return this.mappings.get(`${platform}:${id}`) ?? [];
	}

	async record(spotifyId: string, appleId: string): Promise<void> {
		this.calls.push(`record:${spotifyId}:${appleId}`);
		this.mappings.set(`spotify:${spotifyId}`, [appleId]);
		this.mappings.set(`apple:${appleId}`, [spotifyId]);
	}
}

const SPOTIFY_TRACK_LINK: ParsedMusicLink = {
	platform: "spotify",
	kind: "track",
	id: "track1",
};
const APPLE_ALBUM_LINK: ParsedMusicLink = {
	platform: "apple",
	kind: "album",
	id: "album1",
};

const spotifyTrack: MusicItem = {
	platform: "spotify",
	kind: "track",
	id: "track1",
	title: "Get Lucky",
	artist: "Daft Punk",
	isrc: "USQX91300108",
	url: "https://open.spotify.com/track/track1",
};
const appleTrack: MusicItem = {
	platform: "apple",
	kind: "track",
	id: "song1",
	title: "Get Lucky",
	artist: "Daft Punk",
	isrc: "USQX91300108",
	url: "https://music.apple.com/us/album/x/1?i=2",
};
const appleAlbum: MusicItem = {
	platform: "apple",
	kind: "album",
	id: "album1",
	title: "Random Access Memories",
	artist: "Daft Punk",
	upc: "886443919266",
	url: "https://music.apple.com/us/album/ram/1",
};
const spotifyAlbum: MusicItem = {
	platform: "spotify",
	kind: "album",
	id: "spotify-album1",
	title: "Random Access Memories",
	artist: "Daft Punk",
	upc: "886443919266",
	url: "https://open.spotify.com/album/album1",
};

describe("MusicLinkService", () => {
	test("converts a Spotify track to Apple Music via ISRC", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ byIsrc: appleTrack });
		const service = new MusicLinkService(spotify, apple);

		const result = await service.convert(SPOTIFY_TRACK_LINK);

		expect(result).toEqual({ sourcePlatform: "spotify", target: appleTrack });
		expect(spotify.calls).toEqual(["resolve"]);
		expect(apple.calls).toEqual(["isrc:USQX91300108"]);
	});

	test("converts an Apple album to Spotify via UPC", async () => {
		const spotify = new FakeProvider({ byUpc: spotifyAlbum });
		const apple = new FakeProvider({ resolve: appleAlbum });
		const service = new MusicLinkService(spotify, apple);

		const result = await service.convert(APPLE_ALBUM_LINK);

		expect(result).toEqual({ sourcePlatform: "apple", target: spotifyAlbum });
		expect(apple.calls).toEqual(["resolve"]);
		expect(spotify.calls).toEqual(["upc:886443919266"]);
	});

	test("falls back to text search when the ISRC lookup misses", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ byIsrc: null, text: appleTrack });
		const service = new MusicLinkService(spotify, apple);

		const result = await service.convert(SPOTIFY_TRACK_LINK);

		expect(result).toEqual({ sourcePlatform: "spotify", target: appleTrack });
		expect(apple.calls).toEqual([
			"isrc:USQX91300108",
			"text:Daft Punk Get Lucky",
		]);
	});

	test("does not record a fuzzy text match", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ byIsrc: null, text: appleTrack });
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
			sourcePlatform: "spotify",
			target: appleTrack,
		});
		expect(store.calls).toEqual(["find:spotify:track1"]);
	});

	test("does not record a stable result with a missing or mismatched ISRC", async () => {
		for (const target of [
			{ ...appleTrack, isrc: undefined },
			{ ...appleTrack, isrc: "DIFFERENT" },
		]) {
			const spotify = new FakeProvider({ resolve: spotifyTrack });
			const apple = new FakeProvider({ byIsrc: target });
			const store = new FakeMappingStore();
			const service = new MusicLinkService(spotify, apple, store);

			expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
				sourcePlatform: "spotify",
				target,
			});
			expect(store.calls).toEqual(["find:spotify:track1"]);
		}
	});

	test("uses text search directly when the source has no identifier", async () => {
		const sourceWithoutIsrc: MusicItem = { ...spotifyTrack, isrc: undefined };
		const spotify = new FakeProvider({ resolve: sourceWithoutIsrc });
		const apple = new FakeProvider({ text: appleTrack });
		const service = new MusicLinkService(spotify, apple);

		const result = await service.convert(SPOTIFY_TRACK_LINK);

		expect(result?.target).toEqual(appleTrack);
		expect(apple.calls).toEqual(["text:Daft Punk Get Lucky"]);
	});

	test("returns null when the source link cannot be resolved", async () => {
		const spotify = new FakeProvider({ resolve: null });
		const apple = new FakeProvider({ byIsrc: appleTrack });
		const service = new MusicLinkService(spotify, apple);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toBeNull();
		expect(apple.calls).toEqual([]);
	});

	test("returns null when no target match is found", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ byIsrc: null, text: null });
		const service = new MusicLinkService(spotify, apple);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toBeNull();
	});

	test("uses a cached mapping before resolving the source provider", async () => {
		const spotify = new FakeProvider({ available: false });
		const apple = new FakeProvider({ resolve: appleTrack });
		const store = new FakeMappingStore(
			new Map([["spotify:track1", ["song1"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
			sourcePlatform: "spotify",
			target: appleTrack,
		});
		expect(spotify.calls).toEqual([]);
		expect(apple.calls).toEqual(["resolve"]);
		expect(apple.resolvedLinks).toEqual([
			{ platform: "apple", kind: "track", id: "song1" },
		]);
		expect(store.calls).toEqual(["find:spotify:track1"]);
	});

	test("uses a cached reverse mapping for an Apple Music link", async () => {
		const spotify = new FakeProvider({ resolve: spotifyAlbum });
		const apple = new FakeProvider({ available: false });
		const store = new FakeMappingStore(
			new Map([["apple:album1", ["spotify-album1"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(APPLE_ALBUM_LINK)).toEqual({
			sourcePlatform: "apple",
			target: spotifyAlbum,
		});
		expect(apple.calls).toEqual([]);
		expect(spotify.calls).toEqual(["resolve"]);
	});

	test("tries cached target IDs in order", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({
			resolveResults: [null, appleTrack],
		});
		const store = new FakeMappingStore(
			new Map([["spotify:track1", ["stale-song", "song1"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
			sourcePlatform: "spotify",
			target: appleTrack,
		});
		expect(store.calls).toEqual(["find:spotify:track1"]);
		expect(spotify.calls).toEqual([]);
		expect(apple.calls).toEqual(["resolve", "resolve"]);
	});

	test("continues to the next cached ID when a target lookup throws", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({
			resolveResults: [new Error("temporary provider failure"), appleTrack],
		});
		const store = new FakeMappingStore(
			new Map([["spotify:track1", ["temporarily-unavailable", "song1"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
			sourcePlatform: "spotify",
			target: appleTrack,
		});
		expect(apple.calls).toEqual(["resolve", "resolve"]);
		expect(spotify.calls).toEqual([]);
		expect(store.calls).toEqual(["find:spotify:track1"]);
	});

	test("falls back after every cached target lookup fails", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({
			resolveResults: [new Error("temporary provider failure"), null],
			byIsrc: appleTrack,
		});
		const store = new FakeMappingStore(
			new Map([["spotify:track1", ["temporarily-unavailable", "stale-song"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
			sourcePlatform: "spotify",
			target: appleTrack,
		});
		expect(apple.calls).toEqual(["resolve", "resolve", "isrc:USQX91300108"]);
		expect(spotify.calls).toEqual(["resolve"]);
		expect(store.calls).toEqual(["find:spotify:track1", "record:track1:song1"]);
	});

	test("keeps cached candidates after fallback conversion fails", async () => {
		const spotify = new FakeProvider({ resolve: null });
		const apple = new FakeProvider({ resolve: null });
		const store = new FakeMappingStore(
			new Map([["spotify:track1", ["possibly-transient"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toBeNull();
		expect(store.calls).toEqual(["find:spotify:track1"]);
	});

	test("falls back to normal conversion after cached IDs miss", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({
			resolve: null,
			byIsrc: appleTrack,
		});
		const store = new FakeMappingStore(
			new Map([["spotify:track1", ["stale-song"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
			sourcePlatform: "spotify",
			target: appleTrack,
		});
		expect(store.calls).toEqual(["find:spotify:track1", "record:track1:song1"]);
		expect(spotify.calls).toEqual(["resolve"]);
		expect(apple.calls).toEqual(["resolve", "isrc:USQX91300108"]);
	});

	test("does not query the store when the target provider is unavailable", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ available: false });
		const store = new FakeMappingStore(
			new Map([["spotify:track1", ["song1"]]]),
		);
		const service = new MusicLinkService(spotify, apple, store);

		expect(await service.convert(SPOTIFY_TRACK_LINK)).toBeNull();
		expect(store.calls).toEqual([]);
		expect(spotify.calls).toEqual([]);
	});

	test("records normalized IDs after an uncached conversion", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ byIsrc: appleTrack });
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		await service.convert(SPOTIFY_TRACK_LINK);

		expect(store.calls).toEqual(["find:spotify:track1", "record:track1:song1"]);
	});

	test("records a case-normalized ISRC match", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({
			byIsrc: { ...appleTrack, isrc: appleTrack.isrc?.toLowerCase() },
		});
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		await service.convert(SPOTIFY_TRACK_LINK);

		expect(store.calls).toEqual(["find:spotify:track1", "record:track1:song1"]);
	});

	test("records a verified UPC match", async () => {
		const spotify = new FakeProvider({ byUpc: spotifyAlbum });
		const apple = new FakeProvider({ resolve: appleAlbum });
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		await service.convert(APPLE_ALBUM_LINK);

		expect(store.calls).toEqual([
			"find:apple:album1",
			"record:spotify-album1:album1",
		]);
	});

	test("does not record a stable result with a mismatched UPC", async () => {
		const spotify = new FakeProvider({
			byUpc: { ...spotifyAlbum, upc: "DIFFERENT" },
		});
		const apple = new FakeProvider({ resolve: appleAlbum });
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		await service.convert(APPLE_ALBUM_LINK);

		expect(store.calls).toEqual(["find:apple:album1"]);
	});

	test("records a UPC match with asymmetric leading zero padding", async () => {
		const spotify = new FakeProvider({
			byUpc: { ...spotifyAlbum, upc: `0${spotifyAlbum.upc}` },
		});
		const apple = new FakeProvider({ resolve: appleAlbum });
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		await service.convert(APPLE_ALBUM_LINK);

		expect(store.calls).toEqual([
			"find:apple:album1",
			"record:spotify-album1:album1",
		]);
	});

	test("does not record malformed or different UPC matches", async () => {
		for (const upc of ["886443919267", "886443-919266", ""]) {
			const spotify = new FakeProvider({
				byUpc: { ...spotifyAlbum, upc },
			});
			const apple = new FakeProvider({ resolve: appleAlbum });
			const store = new FakeMappingStore();
			const service = new MusicLinkService(spotify, apple, store);

			await service.convert(APPLE_ALBUM_LINK);

			expect(store.calls).toEqual(["find:apple:album1"]);
		}
	});

	test("does not equate a short numeric code with a zero-padded GTIN", async () => {
		const spotify = new FakeProvider({
			byUpc: { ...spotifyAlbum, upc: "12345678901" },
		});
		const apple = new FakeProvider({
			resolve: { ...appleAlbum, upc: "012345678901" },
		});
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		await service.convert(APPLE_ALBUM_LINK);

		expect(store.calls).toEqual(["find:apple:album1"]);
	});

	test("does not record a fuzzy album match", async () => {
		const spotify = new FakeProvider({ text: spotifyAlbum });
		const apple = new FakeProvider({
			resolve: { ...appleAlbum, upc: undefined },
		});
		const store = new FakeMappingStore();
		const service = new MusicLinkService(spotify, apple, store);

		await service.convert(APPLE_ALBUM_LINK);

		expect(store.calls).toEqual(["find:apple:album1"]);
	});

	test("does not let a mapping store error break normal conversion", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ byIsrc: appleTrack });
		const store: MusicLinkMappingStore = {
			findOtherIds: mock(async () => {
				throw new Error("database unavailable");
			}),
			record: mock(async () => {
				throw new Error("database unavailable");
			}),
		};

		const service = new MusicLinkService(spotify, apple, store);
		expect(await service.convert(SPOTIFY_TRACK_LINK)).toEqual({
			sourcePlatform: "spotify",
			target: appleTrack,
		});
	});

	test("does not swallow errors from the normal conversion path", async () => {
		const spotify = new FakeProvider({
			resolveResults: [new Error("source provider failure")],
		});
		const apple = new FakeProvider();
		const service = new MusicLinkService(
			spotify,
			apple,
			new FakeMappingStore(),
		);

		await expect(service.convert(SPOTIFY_TRACK_LINK)).rejects.toThrow(
			"source provider failure",
		);
	});

	test("is unavailable and converts nothing when Spotify is unconfigured", async () => {
		const spotify = new FakeProvider({ available: false });
		const apple = new FakeProvider({ resolve: appleAlbum });
		const service = new MusicLinkService(spotify, apple);

		expect(service.isAvailable()).toBe(false);
		expect(await service.convert(APPLE_ALBUM_LINK)).toBeNull();
		expect(apple.calls).toEqual([]);
	});

	test("is unavailable and converts nothing when Apple Music is unconfigured", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ available: false });
		const service = new MusicLinkService(spotify, apple);

		expect(service.isAvailable()).toBe(false);
		expect(await service.convert(SPOTIFY_TRACK_LINK)).toBeNull();
		expect(spotify.calls).toEqual([]);
		expect(apple.calls).toEqual([]);
	});

	test("is available with a store when only one provider is available", () => {
		const spotify = new FakeProvider({ available: false });
		const apple = new FakeProvider({ available: true });
		const service = new MusicLinkService(
			spotify,
			apple,
			new FakeMappingStore(),
		);

		expect(service.isAvailable()).toBe(true);
	});
});
