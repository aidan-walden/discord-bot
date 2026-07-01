import type { MusicKind, MusicPlatform } from "../services/musicTypes";

/** A music link detected inside message content. */
export interface ParsedMusicLink {
	platform: MusicPlatform;
	kind: MusicKind;
	/**
	 * The platform's resource id: a Spotify base-62 id, or an Apple Music
	 * numeric catalog id (the song id for tracks, the album id for albums).
	 */
	id: string;
}

// open.spotify.com/track/<id> or /album/<id>, tolerating an "intl-xx/" locale
// prefix and any trailing query string (e.g. ?si=...).
const SPOTIFY_REGEX =
	/https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album)\/([A-Za-z0-9]+)/gi;

// music.apple.com/<storefront>/album/<slug>/<id> (optionally ?i=<songId>) or
// music.apple.com/<storefront>/song/<slug>/<id>. The slug segment is optional.
const APPLE_REGEX =
	/https?:\/\/music\.apple\.com\/[a-z]{2}\/(album|song)\/(?:[^/\s]+\/)?(\d+)(\?[^\s)]*)?/gi;

const APPLE_SONG_QUERY_REGEX = /[?&]i=(\d+)/;

function dedupeKey(link: ParsedMusicLink): string {
	return `${link.platform}:${link.kind}:${link.id}`;
}

/**
 * Scan free-form message content for supported Spotify and Apple Music links.
 * Returns one entry per unique resource, in the order first encountered.
 */
export function detectMusicLinks(content: string): ParsedMusicLink[] {
	const links: ParsedMusicLink[] = [];
	const seen = new Set<string>();

	const add = (link: ParsedMusicLink): void => {
		const key = dedupeKey(link);
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		links.push(link);
	};

	for (const match of content.matchAll(SPOTIFY_REGEX)) {
		const kind = match[1]?.toLowerCase() === "album" ? "album" : "track";
		const id = match[2];
		if (id) {
			add({ platform: "spotify", kind, id });
		}
	}

	for (const match of content.matchAll(APPLE_REGEX)) {
		const type = match[1]?.toLowerCase();
		const pathId = match[2];
		const query = match[3] ?? "";
		if (!pathId) {
			continue;
		}

		if (type === "song") {
			add({ platform: "apple", kind: "track", id: pathId });
			continue;
		}

		// An album URL with an ?i=<songId> query points at a specific track.
		const songMatch = query.match(APPLE_SONG_QUERY_REGEX);
		if (songMatch?.[1]) {
			add({ platform: "apple", kind: "track", id: songMatch[1] });
		} else {
			add({ platform: "apple", kind: "album", id: pathId });
		}
	}

	return links;
}
