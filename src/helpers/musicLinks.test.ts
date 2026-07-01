import { describe, expect, test } from "bun:test";
import { detectMusicLinks } from "./musicLinks";

describe("detectMusicLinks", () => {
	test("parses a Spotify track link", () => {
		const links = detectMusicLinks(
			"check this https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
		);
		expect(links).toEqual([
			{ platform: "spotify", kind: "track", id: "6rqhFgbbKwnb9MLmUQDhG6" },
		]);
	});

	test("parses a Spotify album link", () => {
		const links = detectMusicLinks(
			"https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
		);
		expect(links).toEqual([
			{ platform: "spotify", kind: "album", id: "1DFixLWuPkv3KT3TnV35m3" },
		]);
	});

	test("tolerates an intl locale prefix and a query string", () => {
		const links = detectMusicLinks(
			"https://open.spotify.com/intl-de/track/6rqhFgbbKwnb9MLmUQDhG6?si=abc123",
		);
		expect(links).toEqual([
			{ platform: "spotify", kind: "track", id: "6rqhFgbbKwnb9MLmUQDhG6" },
		]);
	});

	test("parses an Apple Music album link", () => {
		const links = detectMusicLinks(
			"https://music.apple.com/us/album/random-access-memories/617154241",
		);
		expect(links).toEqual([
			{ platform: "apple", kind: "album", id: "617154241" },
		]);
	});

	test("treats an album link with ?i= as a track using the song id", () => {
		const links = detectMusicLinks(
			"https://music.apple.com/us/album/get-lucky/617154241?i=617154366",
		);
		expect(links).toEqual([
			{ platform: "apple", kind: "track", id: "617154366" },
		]);
	});

	test("parses a standalone Apple Music song link", () => {
		const links = detectMusicLinks(
			"https://music.apple.com/gb/song/get-lucky/617154366",
		);
		expect(links).toEqual([
			{ platform: "apple", kind: "track", id: "617154366" },
		]);
	});

	test("parses an Apple Music album link without a slug segment", () => {
		const links = detectMusicLinks(
			"https://music.apple.com/us/album/617154241",
		);
		expect(links).toEqual([
			{ platform: "apple", kind: "album", id: "617154241" },
		]);
	});

	test("detects multiple distinct links and dedupes repeats", () => {
		const links = detectMusicLinks(
			[
				"https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
				"https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6",
				"https://music.apple.com/us/album/x/617154241",
			].join("\n"),
		);
		expect(links).toEqual([
			{ platform: "spotify", kind: "track", id: "6rqhFgbbKwnb9MLmUQDhG6" },
			{ platform: "apple", kind: "album", id: "617154241" },
		]);
	});

	test("returns nothing for content without music links", () => {
		expect(detectMusicLinks("just some text https://example.com")).toEqual([]);
	});
});
