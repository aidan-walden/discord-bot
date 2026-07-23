import type { RiotPlatform } from "../riot/constants";

type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const CACHE_TTL_MS = 60 * 60_000;

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

export default class WolGgClient {
	private readonly cache = new Map<
		string,
		{ expiresAt: number; value: number }
	>();
	private readonly fetcher: Fetcher;
	private readonly now: () => number;

	constructor(options: { fetch?: Fetcher; now?: () => number } = {}) {
		this.fetcher = options.fetch ?? fetch;
		this.now = options.now ?? Date.now;
	}

	clearCache(): void {
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
		const cached = this.cache.get(cacheKey);
		if (cached && cached.expiresAt > this.now()) {
			return cached.value;
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
			this.cache.set(cacheKey, {
				expiresAt: this.now() + CACHE_TTL_MS,
				value: seconds,
			});
			return seconds;
		} catch {
			return null;
		}
	}
}
