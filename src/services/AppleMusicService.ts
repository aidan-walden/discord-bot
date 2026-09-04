import type { AppleAlbum, AppleArtwork, AppleSong } from "node-apple-music";
import * as appleMusic from "node-apple-music";
import type { ParsedMusicLink } from "../helpers/musicLinks";
import { scrapeAppleMusicDeveloperToken } from "./appleMusicToken";
import type { MusicItem, MusicKind } from "./musicTypes";

/**
 * The subset of `node-apple-music` used by {@link AppleMusicService}, extracted
 * into an interface so tests can inject fakes instead of hitting the network.
 */
export interface AppleMusicClient {
	fetchSong: typeof appleMusic.fetchSong;
	fetchAlbum: typeof appleMusic.fetchAlbum;
	fetchIsrc: typeof appleMusic.fetchIsrc;
	fetchUpc: typeof appleMusic.fetchUpc;
	search: typeof appleMusic.search;
	formatArtworkUrl: typeof appleMusic.formatArtworkUrl;
	setToken?: (token: string) => void;
}

export interface AppleMusicTokenSource {
	fetch(): Promise<string>;
}

const defaultClient: AppleMusicClient = {
	fetchSong: appleMusic.fetchSong,
	fetchAlbum: appleMusic.fetchAlbum,
	fetchIsrc: appleMusic.fetchIsrc,
	fetchUpc: appleMusic.fetchUpc,
	search: appleMusic.search,
	formatArtworkUrl: appleMusic.formatArtworkUrl,
	setToken: appleMusic.setToken,
};

const defaultTokenSource: AppleMusicTokenSource = {
	fetch: () => scrapeAppleMusicDeveloperToken(),
};

const ARTWORK_SIZE = 512;
const MISSING_TOKEN_MESSAGE =
	"I don't have a token to use! Did you call fetchToken()?";

/**
 * Wraps the anonymous Apple Music catalog client and normalizes results into
 * {@link MusicItem}. It obtains an anonymous developer token from the Apple
 * Music web bundle, so availability depends on the scrape succeeding.
 */
export default class AppleMusicService {
	private token: string | null = null;
	private tokenFetch: Promise<boolean> | null = null;

	constructor(
		private readonly client: AppleMusicClient = defaultClient,
		private readonly tokenSource: AppleMusicTokenSource = defaultTokenSource,
	) {}

	isAvailable(): boolean {
		return this.token !== null;
	}

	async fetchToken(): Promise<boolean> {
		if (this.tokenFetch) {
			return this.tokenFetch;
		}

		const tokenFetch = this.fetchTokenInternal();
		this.tokenFetch = tokenFetch;
		try {
			return await tokenFetch;
		} finally {
			if (this.tokenFetch === tokenFetch) {
				this.tokenFetch = null;
			}
		}
	}

	/** Resolve an Apple Music track/album link into a normalized item. */
	async resolve(link: ParsedMusicLink): Promise<MusicItem | null> {
		if (link.platform !== "apple") {
			return null;
		}

		if (link.kind === "track") {
			const song = await this.request((token) =>
				this.client.fetchSong(link.id, { token }),
			);
			return song ? this.songToItem(song) : null;
		}

		const album = await this.request((token) =>
			this.client.fetchAlbum(link.id, { token }),
		);
		return album ? this.albumToItem(album) : null;
	}

	/** Find an Apple Music song by ISRC. */
	async findByIsrc(isrc: string): Promise<MusicItem | null> {
		const song = await this.request((token) =>
			this.client.fetchIsrc(isrc, { token }),
		);
		return song ? this.songToItem(song) : null;
	}

	/** Find an Apple Music album by UPC/EAN. */
	async findByUpc(upc: string): Promise<MusicItem | null> {
		const album = await this.request((token) =>
			this.client.fetchUpc(upc, { token }),
		);
		return album ? this.albumToItem(album) : null;
	}

	/** Fallback: best text match for a track or album query. */
	async searchText(kind: MusicKind, query: string): Promise<MusicItem | null> {
		const results = await this.request((token) =>
			this.client.search(query, {
				types: kind === "track" ? "songs" : "albums",
				limit: 1,
				token,
			}),
		);
		if (!results) {
			return null;
		}

		if (kind === "track") {
			const song = results.songs?.[0];
			return song ? this.songToItem(song) : null;
		}

		const album = results.albums?.[0];
		return album ? this.albumToItem(album) : null;
	}

	private async fetchTokenInternal(): Promise<boolean> {
		try {
			const token = await this.tokenSource.fetch();
			if (typeof token !== "string" || token.length === 0) {
				throw new Error("Apple Music token source returned no token.");
			}

			this.token = token;
			this.client.setToken?.(token);
			return true;
		} catch {
			this.token = null;
			console.error("Failed to obtain an Apple Music developer token.");
			return false;
		}
	}

	private async ensureToken(): Promise<boolean> {
		if (this.token !== null) {
			return true;
		}
		return this.fetchToken();
	}

	private async request<T>(
		operation: (token: string) => Promise<T>,
	): Promise<T | null> {
		if (!(await this.ensureToken())) {
			return null;
		}

		const token = this.token;
		if (token === null) {
			return null;
		}

		try {
			const result = await operation(token);
			if (!isUnauthorizedResult(result)) {
				return result;
			}
		} catch (error) {
			if (!isMissingTokenError(error)) {
				throw error;
			}
		}

		return this.retryRequest(operation);
	}

	private async retryRequest<T>(
		operation: (token: string) => Promise<T>,
	): Promise<T | null> {
		this.token = null;
		if (!(await this.fetchToken())) {
			return null;
		}

		const token = this.token;
		if (token === null) {
			return null;
		}

		try {
			const result = await operation(token);
			if (isUnauthorizedResult(result)) {
				this.token = null;
				return null;
			}
			return result;
		} catch (error) {
			if (!isMissingTokenError(error)) {
				throw error;
			}
			this.token = null;
			return null;
		}
	}

	private songToItem(song: AppleSong): MusicItem | null {
		const attributes = song.attributes;
		if (!attributes) {
			return null;
		}
		return {
			platform: "apple",
			kind: "track",
			id: song.id,
			title: attributes.name,
			artist: attributes.artistName,
			isrc: attributes.isrc || undefined,
			url: attributes.url,
			artworkUrl: this.artworkUrl(attributes.artwork),
		};
	}

	private albumToItem(album: AppleAlbum): MusicItem | null {
		const attributes = album.attributes;
		if (!attributes) {
			return null;
		}
		return {
			platform: "apple",
			kind: "album",
			id: album.id,
			title: attributes.name,
			artist: attributes.artistName,
			upc: attributes.upc || undefined,
			url: attributes.url,
			artworkUrl: this.artworkUrl(attributes.artwork),
		};
	}

	private artworkUrl(artwork?: AppleArtwork): string | undefined {
		if (!artwork?.url) {
			return undefined;
		}
		return this.client.formatArtworkUrl(artwork, {
			width: ARTWORK_SIZE,
			height: ARTWORK_SIZE,
		});
	}
}

function isUnauthorizedResult(result: unknown): boolean {
	if (!isRecord(result) || !Array.isArray(result.errors)) {
		return false;
	}

	return result.errors.some(
		(error) =>
			isRecord(error) && (error.status === 401 || error.status === "401"),
	);
}

function isMissingTokenError(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message
			: isRecord(error) && typeof error.message === "string"
				? error.message
				: typeof error === "string"
					? error
					: "";
	return message.includes(MISSING_TOKEN_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
