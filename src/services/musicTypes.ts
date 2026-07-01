/**
 * Shared, platform-agnostic representation of a resolved music resource.
 *
 * Both {@link SpotifyService} and {@link AppleMusicService} normalize their
 * provider-specific payloads into this shape so {@link MusicLinkService} can
 * convert between platforms without caring where an item came from.
 */

export type MusicPlatform = "spotify" | "apple";

export type MusicKind = "track" | "album";

export interface MusicItem {
	platform: MusicPlatform;
	kind: MusicKind;
	title: string;
	artist: string;
	/** International Standard Recording Code, present for tracks. */
	isrc?: string;
	/** Universal/European Article Number (UPC/EAN), present for albums. */
	upc?: string;
	/** Public web URL for the item on its platform. */
	url: string;
	artworkUrl?: string;
}

/** The opposite platform of the given one. */
export function otherPlatform(platform: MusicPlatform): MusicPlatform {
	return platform === "spotify" ? "apple" : "spotify";
}
