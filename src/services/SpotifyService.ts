import type {
	Album,
	SimplifiedAlbum,
	SpotifyApi,
	Track,
} from "@spotify/web-api-ts-sdk";
import type { ParsedMusicLink } from "../helpers/musicLinks";
import type { MusicItem, MusicKind } from "./musicTypes";

/**
 * Wraps the Spotify Web API SDK and normalizes results into {@link MusicItem}.
 *
 * The client is nullable: when Spotify credentials are not configured the
 * service reports {@link isAvailable} as false and every lookup returns null,
 * mirroring the ChatGPT "unavailable" pattern used elsewhere.
 */
export default class SpotifyService {
	constructor(private readonly client: SpotifyApi | null) {}

	isAvailable(): boolean {
		return this.client !== null;
	}

	/** Resolve a Spotify track/album link into a normalized item. */
	async resolve(link: ParsedMusicLink): Promise<MusicItem | null> {
		if (!this.client || link.platform !== "spotify") {
			return null;
		}

		if (link.kind === "track") {
			const track = await this.client.tracks.get(link.id);
			return track ? this.trackToItem(track) : null;
		}

		const album = await this.client.albums.get(link.id);
		return album ? this.albumToItem(album) : null;
	}

	/** Find a Spotify track by ISRC. */
	async findByIsrc(isrc: string): Promise<MusicItem | null> {
		if (!this.client) {
			return null;
		}
		const results = await this.client.search(`isrc:${isrc}`, ["track"]);
		const track = results.tracks?.items?.[0];
		return track ? this.trackToItem(track) : null;
	}

	/** Find a Spotify album by UPC/EAN. */
	async findByUpc(upc: string): Promise<MusicItem | null> {
		if (!this.client) {
			return null;
		}
		const results = await this.client.search(`upc:${upc}`, ["album"]);
		const album = results.albums?.items?.[0];
		return album ? this.albumToItem(album) : null;
	}

	/** Fallback: best text match for a track or album query. */
	async searchText(kind: MusicKind, query: string): Promise<MusicItem | null> {
		if (!this.client) {
			return null;
		}

		if (kind === "track") {
			const results = await this.client.search(query, ["track"]);
			const track = results.tracks?.items?.[0];
			return track ? this.trackToItem(track) : null;
		}

		const results = await this.client.search(query, ["album"]);
		const album = results.albums?.items?.[0];
		return album ? this.albumToItem(album) : null;
	}

	private trackToItem(track: Track): MusicItem {
		return {
			platform: "spotify",
			kind: "track",
			title: track.name,
			artist: this.joinArtists(track.artists),
			isrc: track.external_ids?.isrc || undefined,
			url: track.external_urls.spotify,
			artworkUrl: track.album?.images?.[0]?.url,
		};
	}

	private albumToItem(album: Album | SimplifiedAlbum): MusicItem {
		return {
			platform: "spotify",
			kind: "album",
			title: album.name,
			artist: this.joinArtists(album.artists),
			upc: album.external_ids?.upc || undefined,
			url: album.external_urls.spotify,
			artworkUrl: album.images?.[0]?.url,
		};
	}

	private joinArtists(artists: ReadonlyArray<{ name: string }>): string {
		return artists.map((artist) => artist.name).join(", ");
	}
}
