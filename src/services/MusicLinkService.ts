import type { ParsedMusicLink } from "../helpers/musicLinks";
import {
	type MusicItem,
	type MusicKind,
	type MusicPlatform,
	otherPlatform,
} from "./musicTypes";

/**
 * Common surface implemented by both {@link SpotifyService} and
 * {@link AppleMusicService}, letting the orchestrator treat either platform as
 * a source or a target interchangeably.
 */
export interface MusicProvider {
	isAvailable(): boolean;
	resolve(link: ParsedMusicLink): Promise<MusicItem | null>;
	findByIsrc(isrc: string): Promise<MusicItem | null>;
	findByUpc(upc: string): Promise<MusicItem | null>;
	searchText(kind: MusicKind, query: string): Promise<MusicItem | null>;
}

export interface MusicLinkConversion {
	source: MusicItem;
	target: MusicItem;
}

/**
 * Converts a single music link to its equivalent on the opposite platform.
 *
 * Matching prefers stable identifiers — ISRC for tracks, UPC/EAN for albums —
 * and only falls back to a text search when no identifier match is found.
 */
export default class MusicLinkService {
	constructor(
		private readonly spotify: MusicProvider,
		private readonly apple: MusicProvider,
	) {}

	/**
	 * Both conversion directions read from and/or search Spotify, while Apple
	 * Music is always available, so the feature is usable iff Spotify is.
	 */
	isAvailable(): boolean {
		return this.spotify.isAvailable() && this.apple.isAvailable();
	}

	async convert(link: ParsedMusicLink): Promise<MusicLinkConversion | null> {
		if (!this.isAvailable()) {
			return null;
		}

		const source = await this.providerFor(link.platform).resolve(link);
		if (!source) {
			return null;
		}

		const targetProvider = this.providerFor(otherPlatform(link.platform));
		const target = await this.lookupTarget(targetProvider, source);
		if (!target) {
			return null;
		}

		return { source, target };
	}

	private providerFor(platform: MusicPlatform): MusicProvider {
		return platform === "spotify" ? this.spotify : this.apple;
	}

	private async lookupTarget(
		provider: MusicProvider,
		source: MusicItem,
	): Promise<MusicItem | null> {
		// Prefer stable identifiers first.
		if (source.kind === "track" && source.isrc) {
			const byIsrc = await provider.findByIsrc(source.isrc);
			if (byIsrc) {
				return byIsrc;
			}
		} else if (source.kind === "album" && source.upc) {
			const byUpc = await provider.findByUpc(source.upc);
			if (byUpc) {
				return byUpc;
			}
		}

		// Fall back to a text search on artist + title.
		const query = `${source.artist} ${source.title}`.trim();
		if (query.length === 0) {
			return null;
		}
		return provider.searchText(source.kind, query);
	}
}
