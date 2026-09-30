import type { AppleAlbum, AppleArtwork, AppleSong } from "node-apple-music";
import * as appleMusic from "node-apple-music";
import type { ParsedMusicLink } from "../helpers/musicLinks";
import type { TemporaryStateStore } from "../repositories/TemporaryStateRepository";
import {
	type AppleMusicTokenScrape,
	startAppleMusicTokenScrape,
} from "./appleMusicToken";
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
	start(): AppleMusicTokenScrape;
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
	start: () => startAppleMusicTokenScrape(),
};

/** Redis key holding the last developer token Apple accepted. */
const TOKEN_STATE_KEY = "apple-music:developer-token";
const ARTWORK_SIZE = 512;
const MISSING_TOKEN_MESSAGE =
	"I don't have a token to use! Did you call fetchToken()?";

export interface AppleMusicServiceOptions {
	client?: AppleMusicClient;
	tokenSource?: AppleMusicTokenSource;
	/** Stores the last token Apple accepted so restarts can skip the scrape. */
	temporaryState?: TemporaryStateStore;
}

/**
 * - `initializing`: a stored token is being restored, or a token scrape is
 *   running (at startup or after a 401).
 * - `ready`: a token is loaded and catalog requests can be made.
 * - `failed`: the last scrape ended without a token.
 */
export type AppleMusicStatus = "initializing" | "ready" | "failed";

/**
 * Thrown by catalog methods while {@link AppleMusicService} has no usable
 * token. Its message is safe to show to users; passive consumers should catch
 * it and stay silent.
 */
export class AppleMusicUnavailableError extends Error {
	constructor(readonly status: Exclude<AppleMusicStatus, "ready">) {
		super(
			status === "initializing"
				? "Apple Music is still starting up. Try again in a little while."
				: "Apple Music is unavailable right now.",
		);
		this.name = "AppleMusicUnavailableError";
	}
}

/**
 * Wraps the anonymous Apple Music catalog client and normalizes results into
 * {@link MusicItem}. It obtains an anonymous developer token by scraping the
 * Apple Music web bundle. Once Apple accepts a token, it is stored in
 * temporary state and reused on later startups; a new scrape only happens when
 * no stored token exists or Apple rejects the current one. The service only
 * becomes ready once a token is restored or a scrape completes; until then,
 * and after a failed scrape, catalog methods throw
 * {@link AppleMusicUnavailableError}.
 */
export default class AppleMusicService {
	private token: string | null = null;
	/** The token currently stored in temporary state, if any. */
	private storedToken: string | null = null;
	private state: AppleMusicStatus = "initializing";
	private scrape: AppleMusicTokenScrape | null = null;
	private readonly client: AppleMusicClient;
	private readonly tokenSource: AppleMusicTokenSource;
	private readonly temporaryState: TemporaryStateStore | null;

	constructor(options: AppleMusicServiceOptions = {}) {
		this.client = options.client ?? defaultClient;
		this.tokenSource = options.tokenSource ?? defaultTokenSource;
		this.temporaryState = options.temporaryState ?? null;
	}

	isAvailable(): boolean {
		return this.state === "ready";
	}

	status(): AppleMusicStatus {
		return this.state;
	}

	/**
	 * Restore the stored token if there is one. Otherwise start the token scrape
	 * and wait only for its bounded foreground phase. If the token is not found
	 * by then, the scrape keeps going in the background and the service becomes
	 * ready when it completes. Never throws.
	 */
	async initialize(): Promise<void> {
		if (await this.restoreStoredToken()) {
			return;
		}
		await this.refreshToken().foreground;
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

	private async restoreStoredToken(): Promise<boolean> {
		if (!this.temporaryState) {
			return false;
		}

		let token: unknown;
		try {
			token = await this.temporaryState.get<unknown>(TOKEN_STATE_KEY);
		} catch (error) {
			console.error("Failed to read the stored Apple Music token:", error);
			return false;
		}
		// A scrape may have started while the read was pending.
		if (typeof token !== "string" || token.length === 0 || this.scrape) {
			return false;
		}

		this.applyToken(token);
		if (this.state !== "ready") {
			return false;
		}
		this.storedToken = token;
		return true;
	}

	/** Store a token Apple has just accepted, unless it is already stored. */
	private rememberToken(token: string): void {
		if (
			!this.temporaryState ||
			token !== this.token ||
			token === this.storedToken
		) {
			return;
		}

		this.storedToken = token;
		this.temporaryState.set(TOKEN_STATE_KEY, token).catch((error) => {
			if (this.storedToken === token) {
				this.storedToken = null;
			}
			console.error("Failed to store the Apple Music token:", error);
		});
	}

	/** Drop a rejected token from temporary state if it is the stored one. */
	private forgetToken(token: string): void {
		if (!this.temporaryState || token !== this.storedToken) {
			return;
		}

		this.storedToken = null;
		this.temporaryState.delete(TOKEN_STATE_KEY).catch((error) => {
			console.error("Failed to delete the stored Apple Music token:", error);
		});
	}

	/** Start a token scrape, or join the one already running. */
	private refreshToken(): AppleMusicTokenScrape {
		if (this.scrape) {
			return this.scrape;
		}

		this.token = null;
		this.state = "initializing";

		let scrape: AppleMusicTokenScrape;
		try {
			scrape = this.tokenSource.start();
		} catch (error) {
			scrape = {
				foreground: Promise.resolve(),
				token: Promise.reject(error),
			};
		}

		const settled = scrape.token.then(
			(token) => this.applyToken(token),
			() => this.failTokenScrape(),
		);
		// Settle the foreground once the service state reflects a completed
		// scrape, so callers never observe a finished scrape as still pending.
		const current: AppleMusicTokenScrape = {
			foreground: Promise.race([scrape.foreground, settled]),
			token: scrape.token,
		};
		void settled.finally(() => {
			if (this.scrape === current) {
				this.scrape = null;
			}
		});
		this.scrape = current;
		return current;
	}

	private applyToken(token: string): void {
		if (typeof token !== "string" || token.length === 0) {
			this.failTokenScrape();
			return;
		}

		try {
			this.client.setToken?.(token);
		} catch {
			this.failTokenScrape();
			return;
		}

		this.token = token;
		this.state = "ready";
	}

	private failTokenScrape(): void {
		this.token = null;
		this.state = "failed";
		console.error("Failed to obtain an Apple Music developer token.");
	}

	private requireToken(): string {
		if (this.state !== "ready" || this.token === null) {
			throw new AppleMusicUnavailableError(
				this.state === "ready" ? "failed" : this.state,
			);
		}
		return this.token;
	}

	private async request<T>(
		operation: (token: string) => Promise<T>,
	): Promise<T | null> {
		const token = this.requireToken();
		const result = await this.attempt(operation, token);
		if (result.ok) {
			this.rememberToken(token);
			return result.value;
		}

		// The token was rejected: refresh it, retrying once if the new token
		// arrives within the bounded foreground phase. Skip the refresh when a
		// concurrent request has already replaced the rejected token.
		this.forgetToken(token);
		if (this.token === token || this.state !== "ready") {
			await this.refreshToken().foreground;
		}
		const retryToken = this.requireToken();
		const retry = await this.attempt(operation, retryToken);
		if (retry.ok) {
			this.rememberToken(retryToken);
			return retry.value;
		}

		this.forgetToken(retryToken);
		this.token = null;
		this.state = "failed";
		throw new AppleMusicUnavailableError("failed");
	}

	private async attempt<T>(
		operation: (token: string) => Promise<T>,
		token: string,
	): Promise<{ ok: true; value: T } | { ok: false }> {
		try {
			const value = await operation(token);
			return isUnauthorizedResult(value) ? { ok: false } : { ok: true, value };
		} catch (error) {
			if (isMissingTokenError(error)) {
				return { ok: false };
			}
			throw error;
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
