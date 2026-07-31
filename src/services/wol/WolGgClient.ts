import type { TemporaryStateRepository } from "../../repositories/TemporaryStateRepository";
import type { RiotPlatform } from "../riot/constants";

type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

type TemporaryStateStore = Pick<
	TemporaryStateRepository,
	"get" | "set" | "delete"
>;

const CACHE_TTL_MS = 60 * 60_000;

interface CacheEntry {
	expiresAt: number;
	value: number;
}

/** Riot platform routing value → wol.gg /stats/{region}/ slug. */
export const PLATFORM_TO_WOL_REGION: Record<RiotPlatform, string> = {
	na1: "na",
	euw1: "euw",
	eun1: "eune",
	kr: "kr",
	br1: "br",
	la1: "lan",
	la2: "las",
	oc1: "oce",
	jp1: "jp",
	tr1: "tr",
	ru: "ru",
	ph2: "ph",
	sg2: "sg",
	th2: "th",
	tw2: "tw",
	vn2: "vn",
};

export function wolSlug(gameName: string, tagLine: string): string {
	return `${gameName.replace(/\s+/g, "").toLowerCase()}-${tagLine.toLowerCase()}`;
}

/** Parse `#time-minutes` from a wol.gg stats HTML body. */
export function parseWolMinutes(html: string): number | null {
	const match = html.match(
		/id=["']time-minutes["'][^>]*>[\s\S]*?<p>\s*([\d,]+)/i,
	);
	if (!match?.[1]) {
		return null;
	}
	const minutes = Number(match[1].replace(/,/g, ""));
	return Number.isFinite(minutes) ? minutes : null;
}

function wolRedisKey(cacheKey: string): string {
	return `wol:playtime:${cacheKey}`;
}

function remainingTtlSeconds(expiresAt: number, now: number): number {
	return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

function isCacheEntry(value: unknown): value is CacheEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as CacheEntry).expiresAt === "number" &&
		typeof (value as CacheEntry).value === "number"
	);
}

export default class WolGgClient {
	private readonly cache = new Map<string, CacheEntry>();
	private readonly fetcher: Fetcher;
	private readonly now: () => number;
	private readonly temporaryState?: TemporaryStateStore;

	constructor(
		options: {
			fetch?: Fetcher;
			now?: () => number;
			temporaryState?: TemporaryStateStore;
		} = {},
	) {
		this.fetcher = options.fetch ?? fetch;
		this.now = options.now ?? Date.now;
		this.temporaryState = options.temporaryState;
	}

	async clearCache(): Promise<void> {
		const deletes: Promise<void>[] = [];
		if (this.temporaryState) {
			for (const key of this.cache.keys()) {
				deletes.push(this.temporaryState.delete(wolRedisKey(key)));
			}
		}
		await Promise.all(deletes);
		this.cache.clear();
	}

	/**
	 * Scrape wol.gg career playtime for a Riot ID.
	 * Returns seconds, or null if missing/error (caller should retry).
	 */
	async fetchPlaytimeSeconds(
		platform: RiotPlatform,
		gameName: string,
		tagLine: string,
	): Promise<number | null> {
		const region = PLATFORM_TO_WOL_REGION[platform];
		const cacheKey = `${region}:${gameName.toLowerCase()}:${tagLine.toLowerCase()}`;
		const local = this.cache.get(cacheKey);
		if (local && local.expiresAt > this.now()) {
			return local.value;
		}
		if (local) {
			this.cache.delete(cacheKey);
		}

		if (this.temporaryState) {
			const redisKey = wolRedisKey(cacheKey);
			const remote = await this.temporaryState.get<unknown>(redisKey);
			if (remote !== null) {
				if (isCacheEntry(remote) && remote.expiresAt > this.now()) {
					this.cache.set(cacheKey, remote);
					return remote.value;
				}
				await this.temporaryState.delete(redisKey);
			}
		}

		const slug = wolSlug(gameName, tagLine);
		const url = `https://wol.gg/stats/${region}/${encodeURIComponent(slug)}/`;
		try {
			const response = await this.fetcher(url, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (compatible; discord-bot; +https://github.com/)",
					Accept: "text/html",
				},
			});
			if (!response.ok) {
				return null;
			}
			const minutes = parseWolMinutes(await response.text());
			if (minutes === null) {
				// ponytail: do not cache misses — poller retries next cycle
				return null;
			}
			const seconds = minutes * 60;
			const entry: CacheEntry = {
				expiresAt: this.now() + CACHE_TTL_MS,
				value: seconds,
			};
			this.cache.set(cacheKey, entry);
			if (this.temporaryState) {
				await this.temporaryState.set(
					wolRedisKey(cacheKey),
					entry,
					remainingTtlSeconds(entry.expiresAt, this.now()),
				);
			}
			return seconds;
		} catch {
			return null;
		}
	}
}
