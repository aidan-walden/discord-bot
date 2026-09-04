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

export interface MusicLinkMappingStore {
	findOtherIds(platform: MusicPlatform, id: string): Promise<string[]>;
	record(spotifyId: string, appleId: string): Promise<void>;
}

export interface MusicLinkConversion {
	sourcePlatform: MusicPlatform;
	target: MusicItem;
}

type TargetMatch = {
	target: MusicItem;
	provenance: "isrc" | "upc" | "text";
};

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
		private readonly mappingStore?: MusicLinkMappingStore,
	) {}

	/**
	 * Both conversion directions read from and/or search Spotify and Apple Music,
	 * so the feature is usable only when both providers are available unless a
	 * mapping store can serve a cached conversion.
	 */
	isAvailable(): boolean {
		return this.mappingStore
			? this.spotify.isAvailable() || this.apple.isAvailable()
			: this.spotify.isAvailable() && this.apple.isAvailable();
	}

	async convert(link: ParsedMusicLink): Promise<MusicLinkConversion | null> {
		const targetPlatform = otherPlatform(link.platform);
		const targetProvider = this.providerFor(targetPlatform);
		const sourceProvider = this.providerFor(link.platform);

		if (!targetProvider.isAvailable()) {
			return null;
		}

		if (this.mappingStore) {
			const mappedTargetIds = await this.findMappedIds(link);
			for (const mappedTargetId of mappedTargetIds) {
				let target: MusicItem | null;
				try {
					target = await targetProvider.resolve({
						platform: targetPlatform,
						kind: link.kind,
						id: mappedTargetId,
					});
				} catch {
					continue;
				}
				if (target) {
					return { sourcePlatform: link.platform, target };
				}
			}
		}

		if (!sourceProvider.isAvailable()) {
			return null;
		}

		const source = await sourceProvider.resolve(link);
		if (!source) {
			return null;
		}

		const match = await this.lookupTarget(targetProvider, source);
		if (!match) {
			return null;
		}

		await this.recordMapping(source, match);
		return { sourcePlatform: link.platform, target: match.target };
	}

	private async findMappedIds(link: ParsedMusicLink): Promise<string[]> {
		if (!this.mappingStore) {
			return [];
		}

		try {
			return await this.mappingStore.findOtherIds(link.platform, link.id);
		} catch (error) {
			console.error("Music link mapping lookup failed:", error);
			return [];
		}
	}

	private async recordMapping(
		source: MusicItem,
		match: TargetMatch,
	): Promise<void> {
		if (!this.mappingStore || !this.isVerifiedStableMatch(source, match)) {
			return;
		}

		const spotifyId =
			source.platform === "spotify" ? source.id : match.target.id;
		const appleId = source.platform === "apple" ? source.id : match.target.id;

		try {
			await this.mappingStore.record(spotifyId, appleId);
		} catch (error) {
			console.error("Music link mapping record failed:", error);
		}
	}

	private isVerifiedStableMatch(
		source: MusicItem,
		match: TargetMatch,
  ): boolean {
    const normalizedSourceUpc = source.upc ? normalizeUpc(source.upc) : null;
    const normalizedTargetUpc = match.target.upc ? normalizeUpc(match.target.upc) : null;
		if (
			match.provenance === "isrc" &&
			source.kind === "track" &&
			match.target.platform === otherPlatform(source.platform) &&
			match.target.kind === "track" &&
			source.isrc !== undefined &&
			match.target.isrc !== undefined
		) {
			return source.isrc.toUpperCase() === match.target.isrc.toUpperCase();
		}

		if (
			match.provenance === "upc" &&
			source.kind === "album" &&
			match.target.platform === otherPlatform(source.platform) &&
			match.target.kind === "album" &&
			normalizedSourceUpc !== null &&
			normalizedTargetUpc !== null
		) {
			return normalizedSourceUpc === normalizedTargetUpc;
		}

		return false;
	}

	private providerFor(platform: MusicPlatform): MusicProvider {
		return platform === "spotify" ? this.spotify : this.apple;
	}

	private async lookupTarget(
		provider: MusicProvider,
		source: MusicItem,
	): Promise<TargetMatch | null> {
		// Prefer stable identifiers first.
		if (source.kind === "track" && source.isrc) {
			const byIsrc = await provider.findByIsrc(source.isrc);
			if (byIsrc) {
				return { target: byIsrc, provenance: "isrc" };
			}
		} else if (source.kind === "album" && source.upc) {
			const byUpc = await provider.findByUpc(source.upc);
			if (byUpc) {
				return { target: byUpc, provenance: "upc" };
			}
		}

		// Fall back to a text search on artist + title.
		const query = `${source.artist} ${source.title}`.trim();
		if (query.length === 0) {
			return null;
		}

		const byText = await provider.searchText(source.kind, query);
		return byText ? { target: byText, provenance: "text" } : null;
	}
}

function normalizeUpc(upc: string | undefined): string | null {
	if (!upc || !/^\d{12,14}$/.test(upc) || /^0+$/.test(upc)) {
		return null;
	}

	return upc.padStart(14, "0");
}
