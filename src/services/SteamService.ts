import { randomInt as cryptoRandomInt } from "node:crypto";
import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";

export interface SteamGame {
	appid: number;
	name: string;
}

export class SteamLibraryUnavailableError extends Error {
	constructor(public readonly steamIds: readonly string[]) {
		super(`Steam library unavailable for ${steamIds.join(", ")}`);
		this.name = "SteamLibraryUnavailableError";
	}
}

// Steam store category: Online Co-op
const ONLINE_COOP_CATEGORY_ID = 38;

const OWNED_GAMES_URL =
	"https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/";
const APP_DETAILS_URL = "https://store.steampowered.com/api/appdetails";

type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
type RandomInt = (maxExclusive: number) => number;

function parseOwnedGames(body: unknown, steamId: string): SteamGame[] {
	if (typeof body !== "object" || body === null) {
		throw new Error("Steam owned games response was invalid");
	}
	const response = (body as { response?: unknown }).response;
	if (typeof response !== "object" || response === null) {
		throw new SteamLibraryUnavailableError([steamId]);
	}
	const record = response as { game_count?: unknown; games?: unknown };
	if (record.games === undefined) {
		if (record.game_count === 0) {
			return [];
		}
		throw new SteamLibraryUnavailableError([steamId]);
	}
	if (!Array.isArray(record.games)) {
		throw new Error("Steam owned games response was invalid");
	}

	const byAppid = new Map<number, SteamGame>();
	for (const entry of record.games) {
		if (typeof entry !== "object" || entry === null) {
			continue;
		}
		const game = entry as { appid?: unknown; name?: unknown };
		const appid = game.appid;
		if (typeof appid !== "number" || !Number.isInteger(appid) || appid <= 0) {
			continue;
		}
		if (typeof game.name !== "string") {
			continue;
		}
		const name = game.name.trim();
		if (name.length === 0) {
			continue;
		}
		byAppid.set(appid, { appid, name });
	}
	return [...byAppid.values()];
}

function isOnlineCoopGame(body: unknown, appid: number): boolean | "skip" {
	if (typeof body !== "object" || body === null) {
		return "skip";
	}
	const entry = (body as Record<string, unknown>)[String(appid)];
	if (typeof entry !== "object" || entry === null) {
		return "skip";
	}
	const record = entry as { success?: unknown; data?: unknown };
	if (record.success !== true) {
		return "skip";
	}
	if (typeof record.data !== "object" || record.data === null) {
		return "skip";
	}
	const data = record.data as { type?: unknown; categories?: unknown };
	if (data.type !== "game") {
		return false;
	}
	if (!Array.isArray(data.categories)) {
		return "skip";
	}
	for (const category of data.categories) {
		if (typeof category !== "object" || category === null) {
			continue;
		}
		const id = (category as { id?: unknown }).id;
		if (id === ONLINE_COOP_CATEGORY_ID) {
			return true;
		}
	}
	return false;
}

function shuffleInPlace<T>(items: T[], randomInt: RandomInt): void {
	for (let i = items.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		const tmp = items[i] as T;
		items[i] = items[j] as T;
		items[j] = tmp;
	}
}

export default class SteamService {
	private readonly apiKey: string | null;
	private readonly fetcher: Fetcher;
	private readonly randomInt: RandomInt;

	constructor(
		apiKey: string | null,
		private readonly credentialReporter?: CredentialRejectionReporter,
		options: { fetch?: Fetcher; randomInt?: RandomInt } = {},
	) {
		const trimmed = apiKey?.trim() || null;
		this.apiKey = trimmed && trimmed.length > 0 ? trimmed : null;
		this.fetcher = options.fetch ?? fetch;
		this.randomInt = options.randomInt ?? ((max) => cryptoRandomInt(max));
	}

	isAvailable(): boolean {
		return this.apiKey !== null;
	}

	async findRandomCommonOnlineCoopGame(
		steamIds: readonly string[],
	): Promise<SteamGame | null> {
		if (!this.apiKey) {
			throw new Error("Steam API is not configured");
		}
		if (steamIds.length === 0) {
			return null;
		}

		const uniqueIds = [...new Set(steamIds)];
		const settled = await Promise.allSettled(
			uniqueIds.map((steamId) => this.fetchOwnedGames(steamId)),
		);

		const unavailable: string[] = [];
		const libraries: SteamGame[][] = [];
		for (const [index, result] of settled.entries()) {
			if (result.status === "fulfilled") {
				libraries.push(result.value);
				continue;
			}
			if (result.reason instanceof SteamLibraryUnavailableError) {
				unavailable.push(uniqueIds[index] as string);
				continue;
			}
			throw result.reason;
		}
		if (unavailable.length > 0) {
			throw new SteamLibraryUnavailableError(unavailable);
		}

		let common: SteamGame[] | null = null;
		for (const library of libraries) {
			const byAppid = new Map(library.map((game) => [game.appid, game]));
			if (common === null) {
				common = [...byAppid.values()];
				continue;
			}
			common = common.filter((game) => byAppid.has(game.appid));
			if (common.length === 0) {
				return null;
			}
		}

		if (common === null || common.length === 0) {
			return null;
		}

		const candidates = [...common];
		shuffleInPlace(candidates, this.randomInt);

		for (const candidate of candidates) {
			const eligible = await this.isEligibleOnlineCoop(candidate.appid);
			if (eligible) {
				return candidate;
			}
		}
		return null;
	}

	private async fetchOwnedGames(steamId: string): Promise<SteamGame[]> {
		const url = new URL(OWNED_GAMES_URL);
		url.searchParams.set("key", this.apiKey as string);
		url.searchParams.set("steamid", steamId);
		url.searchParams.set("include_appinfo", "true");
		url.searchParams.set("include_played_free_games", "true");

		let response: Response;
		try {
			response = await this.fetcher(url);
		} catch {
			throw new Error("Steam owned games request failed");
		}

		if (response.status === 401 || response.status === 403) {
			this.credentialReporter?.recordCredentialRejection("steam");
		}
		if (!response.ok) {
			throw new Error(`Steam owned games returned HTTP ${response.status}`);
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new Error("Steam owned games response was invalid");
		}
		return parseOwnedGames(body, steamId);
	}

	private async isEligibleOnlineCoop(appid: number): Promise<boolean> {
		const url = new URL(APP_DETAILS_URL);
		url.searchParams.set("appids", String(appid));
		url.searchParams.set("filters", "basic,categories");

		let response: Response;
		try {
			response = await this.fetcher(url);
		} catch {
			throw new Error("Steam storefront request failed");
		}
		if (!response.ok) {
			throw new Error(`Steam storefront returned HTTP ${response.status}`);
		}

		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new Error("Steam storefront response was invalid");
		}

		const result = isOnlineCoopGame(body, appid);
		return result === true;
	}
}
