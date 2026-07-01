import { describe, expect, test } from "bun:test";
import type { ParsedMusicLink } from "../helpers/musicLinks";
import MusicLinkService, { type MusicProvider } from "./MusicLinkService";
import type { MusicItem } from "./musicTypes";

/** A configurable fake provider that records how it was queried. */
class FakeProvider implements MusicProvider {
	calls: string[] = [];

	constructor(
		private readonly behavior: {
			available?: boolean;
			resolve?: MusicItem | null;
			byIsrc?: MusicItem | null;
			byUpc?: MusicItem | null;
			text?: MusicItem | null;
		} = {},
	) {}

	isAvailable(): boolean {
		return this.behavior.available ?? true;
	}

	async resolve(_link: ParsedMusicLink): Promise<MusicItem | null> {
		this.calls.push("resolve");
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
	title: "Get Lucky",
	artist: "Daft Punk",
	isrc: "USQX91300108",
	url: "https://open.spotify.com/track/track1",
};
const appleTrack: MusicItem = {
	platform: "apple",
	kind: "track",
	title: "Get Lucky",
	artist: "Daft Punk",
	isrc: "USQX91300108",
	url: "https://music.apple.com/us/album/x/1?i=2",
};
const appleAlbum: MusicItem = {
	platform: "apple",
	kind: "album",
	title: "Random Access Memories",
	artist: "Daft Punk",
	upc: "886443919266",
	url: "https://music.apple.com/us/album/ram/1",
};
const spotifyAlbum: MusicItem = {
	platform: "spotify",
	kind: "album",
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

		expect(result).toEqual({ source: spotifyTrack, target: appleTrack });
		expect(spotify.calls).toEqual(["resolve"]);
		expect(apple.calls).toEqual(["isrc:USQX91300108"]);
	});

	test("converts an Apple album to Spotify via UPC", async () => {
		const spotify = new FakeProvider({ byUpc: spotifyAlbum });
		const apple = new FakeProvider({ resolve: appleAlbum });
		const service = new MusicLinkService(spotify, apple);

		const result = await service.convert(APPLE_ALBUM_LINK);

		expect(result).toEqual({ source: appleAlbum, target: spotifyAlbum });
		expect(apple.calls).toEqual(["resolve"]);
		expect(spotify.calls).toEqual(["upc:886443919266"]);
	});

	test("falls back to text search when the ISRC lookup misses", async () => {
		const spotify = new FakeProvider({ resolve: spotifyTrack });
		const apple = new FakeProvider({ byIsrc: null, text: appleTrack });
		const service = new MusicLinkService(spotify, apple);

		const result = await service.convert(SPOTIFY_TRACK_LINK);

		expect(result).toEqual({ source: spotifyTrack, target: appleTrack });
		expect(apple.calls).toEqual([
			"isrc:USQX91300108",
			"text:Daft Punk Get Lucky",
		]);
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

	test("is unavailable and converts nothing when Spotify is unconfigured", async () => {
		const spotify = new FakeProvider({ available: false });
		const apple = new FakeProvider({ resolve: appleAlbum });
		const service = new MusicLinkService(spotify, apple);

		expect(service.isAvailable()).toBe(false);
		expect(await service.convert(APPLE_ALBUM_LINK)).toBeNull();
		expect(apple.calls).toEqual([]);
	});
});
