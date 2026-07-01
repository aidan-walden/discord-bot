/**
 * Minimal type declarations for the untyped `node-apple-music` package.
 *
 * Only the surface actually used by {@link AppleMusicService} is declared. The
 * fetch/search helpers return raw Apple Music API catalog resources, so the
 * shapes below mirror the relevant subset of that API.
 */
declare module "node-apple-music" {
	export interface AppleArtwork {
		url: string;
		width?: number;
		height?: number;
	}

	export interface AppleSongAttributes {
		name: string;
		artistName: string;
		url: string;
		isrc?: string;
		albumName?: string;
		artwork?: AppleArtwork;
	}

	export interface AppleAlbumAttributes {
		name: string;
		artistName: string;
		url: string;
		upc?: string;
		artwork?: AppleArtwork;
	}

	export interface AppleResource<Attributes> {
		id: string;
		type: string;
		href?: string;
		attributes?: Attributes;
	}

	export type AppleSong = AppleResource<AppleSongAttributes>;
	export type AppleAlbum = AppleResource<AppleAlbumAttributes>;

	export interface AppleFetchOptions {
		countryCode?: string;
		lang?: string;
		[key: string]: unknown;
	}

	export interface AppleSearchOptions extends AppleFetchOptions {
		types?: string;
		limit?: number;
	}

	export interface AppleSearchResults {
		songs?: AppleSong[];
		albums?: AppleAlbum[];
		[key: string]: unknown;
	}

	export interface AppleArtworkFormatOptions {
		width?: number;
		height?: number;
		size?: number;
		format?: string;
	}

	export function fetchSong(
		id: string,
		options?: AppleFetchOptions,
	): Promise<AppleSong | null>;
	export function fetchAlbum(
		id: string,
		options?: AppleFetchOptions,
	): Promise<AppleAlbum | null>;
	export function fetchIsrc(
		isrc: string,
		options?: AppleFetchOptions,
	): Promise<AppleSong | null>;
	export function fetchUpc(
		upc: string,
		options?: AppleFetchOptions,
	): Promise<AppleAlbum | null>;
	export function search(
		term: string,
		options?: AppleSearchOptions,
	): Promise<AppleSearchResults | null>;
	export function formatArtworkUrl(
		artwork: AppleArtwork,
		options?: AppleArtworkFormatOptions,
	): string;
}
