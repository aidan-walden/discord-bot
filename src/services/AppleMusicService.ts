import type { AppleAlbum, AppleArtwork, AppleSong } from "node-apple-music";
import * as appleMusic from "node-apple-music";
import type { ParsedMusicLink } from "../helpers/musicLinks";
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
}

const defaultClient: AppleMusicClient = {
	fetchSong: appleMusic.fetchSong,
	fetchAlbum: appleMusic.fetchAlbum,
	fetchIsrc: appleMusic.fetchIsrc,
	fetchUpc: appleMusic.fetchUpc,
	search: appleMusic.search,
	formatArtworkUrl: appleMusic.formatArtworkUrl,
};

const ARTWORK_SIZE = 512;

/**
 * Wraps the anonymous Apple Music catalog client and normalizes results into
 * {@link MusicItem}. Requires no credentials, so it is always available.
 */
export default class AppleMusicService {
	constructor(private readonly client: AppleMusicClient = defaultClient) {}

	isAvailable(): boolean {
		return true;
	}

	/** Resolve an Apple Music track/album link into a normalized item. */
	async resolve(link: ParsedMusicLink): Promise<MusicItem | null> {
		if (link.platform !== "apple") {
			return null;
		}

		if (link.kind === "track") {
			const song = await this.client.fetchSong(link.id);
			return song ? this.songToItem(song) : null;
		}

		const album = await this.client.fetchAlbum(link.id);
		return album ? this.albumToItem(album) : null;
	}

	/** Find an Apple Music song by ISRC. */
	async findByIsrc(isrc: string): Promise<MusicItem | null> {
		const song = await this.client.fetchIsrc(isrc);
		return song ? this.songToItem(song) : null;
	}

	/** Find an Apple Music album by UPC/EAN. */
	async findByUpc(upc: string): Promise<MusicItem | null> {
		const album = await this.client.fetchUpc(upc);
		return album ? this.albumToItem(album) : null;
	}

	/** Fallback: best text match for a track or album query. */
	async searchText(kind: MusicKind, query: string): Promise<MusicItem | null> {
		const results = await this.client.search(query, {
			types: kind === "track" ? "songs" : "albums",
			limit: 1,
		});
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

	private songToItem(song: AppleSong): MusicItem | null {
		const attributes = song.attributes;
		if (!attributes) {
			return null;
		}
		return {
			platform: "apple",
			kind: "track",
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
