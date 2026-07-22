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

export const PLATFORM_TO_REGION: Record<RiotPlatform, RiotRegion> = {
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

export const ACCOUNT_CACHE_TTL_MS = 10 * 60_000;
export const MATCH_CACHE_TTL_MS = 60 * 60_000;
export const DEFAULT_429_RETRY_MS = 1_000;
export const SOLO_QUEUE = "RANKED_SOLO_5x5";
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;
export const RANK_HISTORY_LIMIT = 5;

export function platformToRegion(platform: RiotPlatform): RiotRegion {
	return PLATFORM_TO_REGION[platform];
}
