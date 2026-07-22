import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";

export const RIOT_PLATFORMS = [
	"br1",
	"eun1",
	"euw1",
	"jp1",
	"kr",
	"la1",
	"la2",
	"na1",
	"oc1",
	"tr1",
	"ru",
	"ph2",
	"sg2",
	"th2",
	"tw2",
	"vn2",
] as const;

export type RiotPlatform = (typeof RIOT_PLATFORMS)[number];

export const RIOT_REGIONS = ["americas", "europe", "asia", "sea"] as const;
export type RiotRegion = (typeof RIOT_REGIONS)[number];

const PLATFORM_TO_REGION: Record<RiotPlatform, RiotRegion> = {
	br1: "americas",
	la1: "americas",
	la2: "americas",
	na1: "americas",
	oc1: "sea",
	ph2: "sea",
	sg2: "sea",
	th2: "sea",
	tw2: "sea",
	vn2: "sea",
	eun1: "europe",
	euw1: "europe",
	tr1: "europe",
	ru: "europe",
	jp1: "asia",
	kr: "asia",
};

const ACCOUNT_CACHE_TTL_MS = 10 * 60_000;
const MATCH_CACHE_TTL_MS = 60 * 60_000;
const DEFAULT_429_RETRY_MS = 1_000;

type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface RiotGamesServiceOptions {
	fetch?: Fetcher;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}

export interface RiotAccount {
	puuid: string;
	gameName: string;
	tagLine: string;
}

export interface RiotMatchParticipant {
	puuid: string;
	championId: number;
	champLevel: number;
	kills: number;
	deaths: number;
	assists: number;
	win: boolean;
	teamId: number;
	totalMinionsKilled: number;
	visionScore: number;
	goldEarned: number;
	item0: number;
	item1: number;
	item2: number;
	item3: number;
	item4: number;
	item5: number;
	item6: number;
}

export interface RiotMatch {
	metadata: {
		matchId: string;
		participants: string[];
	};
	info: {
		gameCreation: number;
		gameDuration: number;
		queueId: number;
		participants: RiotMatchParticipant[];
	};
}

export interface RiotLeagueEntry {
	queueType: string;
	tier: string;
	rank: string;
	leaguePoints: number;
	wins: number;
	losses: number;
}

export class RiotGamesError extends Error {
	readonly status: number;
	readonly retryAfterMs?: number;

	constructor(message: string, status: number, retryAfterMs?: number) {
		super(message);
		this.name = "RiotGamesError";
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}

export function platformToRegion(platform: RiotPlatform): RiotRegion {
	return PLATFORM_TO_REGION[platform];
}

interface CacheEntry<T> {
	expiresAt: number;
	value: T;
}

interface RateBucket {
	limit: number;
	windowMs: number;
	count: number;
	/** Wall time when the current window started (approx from first observed count). */
	windowStartMs: number;
}

function parseRetryAfterMs(header: string | null): number | undefined {
	if (!header) {
		return undefined;
	}
	const seconds = Number(header);
	if (!Number.isFinite(seconds) || seconds < 0) {
		return undefined;
	}
	return Math.ceil(seconds * 1000);
}

/** Parse `n:windowSeconds` comma lists from Riot rate-limit headers. */
function parseRateLimitPairs(header: string | null): Array<{
	limit: number;
	windowMs: number;
}> {
	if (!header) {
		return [];
	}
	return header
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const [limitRaw, windowRaw] = part.split(":");
			const limit = Number(limitRaw);
			const windowSeconds = Number(windowRaw);
			if (
				!Number.isFinite(limit) ||
				!Number.isFinite(windowSeconds) ||
				limit <= 0 ||
				windowSeconds <= 0
			) {
				return null;
			}
			return { limit, windowMs: windowSeconds * 1000 };
		})
		.filter(
			(pair): pair is { limit: number; windowMs: number } => pair !== null,
		);
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Thin Riot Games API client for LoL account/match/league lookups.
 * Optional key: unavailable when unset. Rate-limit aware for polling consumers.
 */
export default class RiotGamesService {
	private readonly apiKey: string | null;
	private readonly fetcher: Fetcher;
	private readonly sleep: (ms: number) => Promise<void>;
	private readonly now: () => number;
	private readonly accountCache = new Map<string, CacheEntry<RiotAccount>>();
	private readonly matchCache = new Map<string, CacheEntry<RiotMatch>>();
	/** host → bucketKey → state */
	private readonly rateBuckets = new Map<string, Map<string, RateBucket>>();

	constructor(
		apiKey: string | null,
		private readonly credentialReporter?: CredentialRejectionReporter,
		options: RiotGamesServiceOptions = {},
	) {
		const trimmed = apiKey?.trim() || null;
		this.apiKey = trimmed;
		this.fetcher = options.fetch ?? fetch;
		this.sleep = options.sleep ?? defaultSleep;
		this.now = options.now ?? Date.now;
	}

	isAvailable(): boolean {
		return this.apiKey !== null;
	}

	clearCache(): void {
		this.accountCache.clear();
		this.matchCache.clear();
	}

	async getAccountByRiotId(
		region: RiotRegion,
		gameName: string,
		tagLine: string,
	): Promise<RiotAccount | null> {
		if (!this.apiKey) {
			return null;
		}
		const cacheKey = `${region}:${gameName.toLowerCase()}:${tagLine.toLowerCase()}`;
		const cached = this.getCached(this.accountCache, cacheKey);
		if (cached) {
			return cached;
		}

		const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
		try {
			const account = await this.request<RiotAccount>(region, path);
			this.accountCache.set(cacheKey, {
				expiresAt: this.now() + ACCOUNT_CACHE_TTL_MS,
				value: account,
			});
			return account;
		} catch (error) {
			if (error instanceof RiotGamesError && error.status === 404) {
				return null;
			}
			throw error;
		}
	}

	async getMatchIdsByPuuid(
		region: RiotRegion,
		puuid: string,
		opts?: { start?: number; count?: number },
	): Promise<string[]> {
		if (!this.apiKey) {
			return [];
		}
		const path = `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids`;
		return this.request<string[]>(region, path, {
			start: opts?.start,
			count: opts?.count,
		});
	}

	async getMatch(
		region: RiotRegion,
		matchId: string,
	): Promise<RiotMatch | null> {
		if (!this.apiKey) {
			return null;
		}
		const cacheKey = `${region}:${matchId}`;
		const cached = this.getCached(this.matchCache, cacheKey);
		if (cached) {
			return cached;
		}

		const path = `/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
		try {
			const match = await this.request<RiotMatch>(region, path);
			this.matchCache.set(cacheKey, {
				expiresAt: this.now() + MATCH_CACHE_TTL_MS,
				value: match,
			});
			return match;
		} catch (error) {
			if (error instanceof RiotGamesError && error.status === 404) {
				return null;
			}
			throw error;
		}
	}

	async getLeagueEntriesByPuuid(
		platform: RiotPlatform,
		puuid: string,
	): Promise<RiotLeagueEntry[]> {
		if (!this.apiKey) {
			return [];
		}
		const path = `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`;
		return this.request<RiotLeagueEntry[]>(platform, path);
	}

	async request<T>(
		routing: RiotRegion | RiotPlatform,
		path: string,
		query?: Record<string, string | number | undefined>,
	): Promise<T> {
		if (!this.apiKey) {
			throw new RiotGamesError("Riot API key is not configured", 0);
		}

		const host = `${routing}.api.riotgames.com`;
		const url = new URL(
			path.startsWith("/") ? path : `/${path}`,
			`https://${host}`,
		);
		if (query) {
			for (const [key, value] of Object.entries(query)) {
				if (value !== undefined) {
					url.searchParams.set(key, String(value));
				}
			}
		}

		return this.fetchWithRateLimit<T>(host, url.toString());
	}

	private getCached<T>(
		cache: Map<string, CacheEntry<T>>,
		key: string,
	): T | undefined {
		const entry = cache.get(key);
		if (!entry) {
			return undefined;
		}
		if (entry.expiresAt <= this.now()) {
			cache.delete(key);
			return undefined;
		}
		return entry.value;
	}

	private async fetchWithRateLimit<T>(
		host: string,
		url: string,
		retried = false,
	): Promise<T> {
		await this.waitForRateLimit(host);

		const response = await this.fetcher(url, {
			headers: { "X-Riot-Token": this.apiKey as string },
		});

		this.recordRateLimitHeaders(host, response.headers);

		if (response.status === 401 || response.status === 403) {
			this.credentialReporter?.recordCredentialRejection("riot");
		}

		if (response.status === 429) {
			const retryAfterMs =
				parseRetryAfterMs(response.headers.get("Retry-After")) ??
				DEFAULT_429_RETRY_MS;
			if (!retried) {
				await this.sleep(retryAfterMs);
				return this.fetchWithRateLimit<T>(host, url, true);
			}
			throw new RiotGamesError(`Riot returned HTTP 429`, 429, retryAfterMs);
		}

		if (!response.ok) {
			throw new RiotGamesError(
				`Riot returned HTTP ${response.status}`,
				response.status,
			);
		}

		return (await response.json()) as T;
	}

	private async waitForRateLimit(host: string): Promise<void> {
		const buckets = this.rateBuckets.get(host);
		if (!buckets) {
			return;
		}

		const now = this.now();
		let waitMs = 0;
		for (const bucket of buckets.values()) {
			const elapsed = now - bucket.windowStartMs;
			if (elapsed >= bucket.windowMs) {
				bucket.count = 0;
				bucket.windowStartMs = now;
				continue;
			}
			if (bucket.count >= bucket.limit) {
				waitMs = Math.max(waitMs, bucket.windowMs - elapsed);
			}
		}
		if (waitMs > 0) {
			await this.sleep(waitMs);
		}
	}

	private recordRateLimitHeaders(host: string, headers: Headers): void {
		const limits = [
			...parseRateLimitPairs(headers.get("X-App-Rate-Limit")).map(
				(pair, index) => ({
					key: `app:${pair.windowMs}`,
					limit: pair.limit,
					windowMs: pair.windowMs,
					count: parseRateLimitPairs(headers.get("X-App-Rate-Limit-Count"))[
						index
					]?.limit,
				}),
			),
			...parseRateLimitPairs(headers.get("X-Method-Rate-Limit")).map(
				(pair, index) => ({
					key: `method:${pair.windowMs}`,
					limit: pair.limit,
					windowMs: pair.windowMs,
					count: parseRateLimitPairs(headers.get("X-Method-Rate-Limit-Count"))[
						index
					]?.limit,
				}),
			),
		];

		if (limits.length === 0) {
			return;
		}

		let buckets = this.rateBuckets.get(host);
		if (!buckets) {
			buckets = new Map();
			this.rateBuckets.set(host, buckets);
		}

		const now = this.now();
		for (const entry of limits) {
			if (entry.count === undefined) {
				continue;
			}
			const existing = buckets.get(entry.key);
			if (
				!existing ||
				existing.limit !== entry.limit ||
				existing.windowMs !== entry.windowMs ||
				now - existing.windowStartMs >= entry.windowMs
			) {
				buckets.set(entry.key, {
					limit: entry.limit,
					windowMs: entry.windowMs,
					count: entry.count,
					windowStartMs: now,
				});
			} else {
				existing.count = entry.count;
			}
		}
	}
}
