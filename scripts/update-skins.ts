#!/usr/bin/env bun
/**
 * Keep assets/skins.json (the priced unbox catalog, scraped from stash.clash.gg)
 * up to date by detecting drift against the ByMykel CSGO-API, then re-scraping
 * only the cases that drifted.
 *
 * ByMykel has no pricing, so it can only tell us *which* cases changed. The
 * actual price scrape stays in the Go scraper (Cloudflare gates stash.clash.gg
 * on TLS fingerprint, which Bun's fetch cannot forge). Run manually or via cron:
 *   bun scripts/update-skins.ts
 */
import path from "node:path";
import type {
	CounterStrikeCaseCatalog,
	CounterStrikeSkinsFile,
} from "../src/models/CounterStrikeSkin";

const BYMYKEL_URL =
	"https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/skins.json";
const BYMYKEL_COMMITS_URL =
	"https://api.github.com/repos/ByMykel/CSGO-API/commits?path=public/api/en/skins.json&per_page=1";
const ASSET_PATH = path.resolve(import.meta.dirname, "../assets/skins.json");
const SCRAPER_DIR =
	process.env.SCRAPER_DIR ??
	path.resolve(import.meta.dirname, "../csgo-skins-scraper");

type Bucket = "blue" | "purple" | "pink" | "red" | "gold";
const BUCKETS: Bucket[] = ["blue", "purple", "pink", "red", "gold"];

export interface ByMykelSkin {
	name: string;
	rarity: { id: string };
	category: { name: string };
	weapon: { weapon_id: number };
	paint_index: string | null;
	phase?: string;
	crates?: { name: string }[];
}

/** ByMykel rarity id → our case bucket, or null if the skin isn't in unbox pools. */
export function getBucket(skin: ByMykelSkin): Bucket | null {
	switch (skin.rarity.id) {
		case "rarity_rare_weapon":
			return "blue";
		case "rarity_mythical_weapon":
			return "purple";
		case "rarity_legendary_weapon":
			return "pink";
		case "rarity_ancient_weapon":
			// Knives share this id with Covert weapons; disambiguate by category.
			return skin.category.name === "Knives" ? "gold" : "red";
		case "rarity_ancient": // gloves ("Extraordinary")
			return "gold";
		default:
			return null; // industrial / consumer / contraband — not unboxable here
	}
}

/**
 * Canonicalize a skin name so ByMykel and local forms compare equal:
 * drop ByMykel's leading "★ " (knives/gloves) and collapse vanilla knives,
 * which ByMykel names "★ Bayonet" but local stores "Bayonet | ★ (Vanilla)".
 */
export function normalizeName(name: string): string {
	return name
		.replace(/^★\s+/, "")
		.replace(/\s*\|\s*★?\s*(?:\(Vanilla\)|Vanilla)$/i, "")
		.trim();
}

export function enrichInspectMetadata(
	local: CounterStrikeCaseCatalog,
	skins: ByMykelSkin[],
): number {
	const byName = new Map<string, ByMykelSkin>();
	for (const skin of skins) {
		const name = normalizeName(skin.name);
		const current = byName.get(name);
		// Generic Doppler entries use Phase 1 because the local catalog has no phase.
		if (!current || skin.phase === "Phase 1") {
			byName.set(name, skin);
		}
	}

	let changed = 0;
	for (const definition of Object.values(local)) {
		for (const skin of definition.gold) {
			const metadata = byName.get(normalizeName(skin.name));
			if (!metadata) {
				console.error(`  warning: no inspect metadata for "${skin.name}"`);
				continue;
			}

			const defIndex = metadata.weapon.weapon_id;
			const paintIndex = Number(metadata.paint_index ?? 0);
			if (skin.defIndex !== defIndex || skin.paintIndex !== paintIndex) {
				skin.defIndex = defIndex;
				skin.paintIndex = paintIndex;
				changed++;
			}
		}
	}

	return changed;
}

type ExpectedCatalog = Map<string, Map<Bucket, Set<string>>>;

function buildExpected(skins: ByMykelSkin[]): ExpectedCatalog {
	const expected: ExpectedCatalog = new Map();
	for (const skin of skins) {
		const bucket = getBucket(skin);
		if (!bucket || !skin.crates) continue;
		const name = normalizeName(skin.name);
		// Vanilla knives (bare "Navaja Knife", no "| pattern") aren't listed on
		// stash.clash.gg, so we can never scrape a price for them — tracking them
		// would flag those cases stale forever. Every real skin has "weapon | finish".
		if (!name.includes("|")) continue;
		for (const crate of skin.crates) {
			// ponytail: weapon cases are the only stash.clash.gg-scrapable containers;
			// filter by the "Case" naming convention to skip souvenir packages / capsules.
			// If Valve ever ships a case not named "... Case", widen this.
			if (!/case/i.test(crate.name)) continue;
			let byBucket = expected.get(crate.name);
			if (!byBucket) {
				byBucket = new Map();
				expected.set(crate.name, byBucket);
			}
			let set = byBucket.get(bucket);
			if (!set) {
				set = new Set();
				byBucket.set(bucket, set);
			}
			set.add(name);
		}
	}
	return expected;
}

/** Set of normalized skin names present locally for a case bucket. */
function localBucketNames(
	local: CounterStrikeCaseCatalog,
	caseName: string,
	bucket: Bucket,
): Set<string> {
	const skins = local[caseName]?.[bucket] ?? [];
	return new Set(skins.map((s) => normalizeName(s.name)));
}

/** Cases that are new or have at least one skin the local file is missing. */
function findStaleCases(
	expected: ExpectedCatalog,
	local: CounterStrikeCaseCatalog,
): string[] {
	const stale: string[] = [];
	for (const [caseName, byBucket] of expected) {
		if (!local[caseName]) {
			console.error(`  new case: ${caseName}`);
			stale.push(caseName);
			continue;
		}
		const missing: string[] = [];
		for (const bucket of BUCKETS) {
			const want = byBucket.get(bucket);
			if (!want) continue;
			const have = localBucketNames(local, caseName, bucket);
			for (const name of want) {
				if (!have.has(name)) missing.push(`${bucket}:${name}`);
			}
		}
		if (missing.length > 0) {
			console.error(
				`  stale case: ${caseName} (missing ${missing.join(", ")})`,
			);
			stale.push(caseName);
		}
	}
	return stale;
}

/** Unix seconds for the latest ByMykel commit that touched skins.json. */
export async function fetchByMykelUpdatedAt(): Promise<number> {
	const res = await fetch(BYMYKEL_COMMITS_URL, {
		headers: { Accept: "application/vnd.github+json" },
	});
	if (!res.ok) {
		throw new Error(`ByMykel commits fetch failed: ${res.status}`);
	}
	const commits = (await res.json()) as {
		commit?: { committer?: { date?: string } };
	}[];
	const date = commits[0]?.commit?.committer?.date;
	if (!date) {
		throw new Error("ByMykel commits response missing committer date.");
	}
	const unix = Math.floor(Date.parse(date) / 1000);
	if (!Number.isFinite(unix)) {
		throw new Error(`ByMykel committer date unparseable: ${date}`);
	}
	return unix;
}

/** Run the Go scraper for the given cases and return its case map. */
async function scrapeCases(cases: string[]): Promise<CounterStrikeCaseCatalog> {
	const proc = Bun.spawn(["go", "run", ".", "-stdout", ...cases], {
		cwd: SCRAPER_DIR,
		stdout: "pipe",
		stderr: "inherit",
	});
	const out = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) {
		throw new Error(`scraper exited with code ${code}`);
	}
	const parsed = JSON.parse(out) as { cases: CounterStrikeCaseCatalog };
	return parsed.cases;
}

/**
 * A scraped case is only safe to merge if it has a price and every rarity
 * bucket has at least one skin — runUnboxSimulation rolls all five tiers and
 * chooseRandomSkin throws on an empty bucket, so a half-scraped case (e.g. no
 * gold/knife data) would crash /unbox. Reject those instead of writing them.
 */
export function isUsableCase(
	result: CounterStrikeCaseCatalog[string],
): boolean {
	return (
		result.price > 0 &&
		BUCKETS.every((bucket) => (result[bucket]?.length ?? 0) > 0)
	);
}

async function main(): Promise<void> {
	console.error(`Fetching ByMykel skins from ${BYMYKEL_URL} ...`);
	const [skinsRes, scrapedAt] = await Promise.all([
		fetch(BYMYKEL_URL),
		fetchByMykelUpdatedAt(),
	]);
	if (!skinsRes.ok) {
		throw new Error(`ByMykel fetch failed: ${skinsRes.status}`);
	}
	const skins = (await skinsRes.json()) as ByMykelSkin[];

	const file = (await Bun.file(ASSET_PATH).json()) as CounterStrikeSkinsFile;
	const local = file.cases;
	const expected = buildExpected(skins);

	console.error("Diffing against local catalog ...");
	const stale = findStaleCases(expected, local);
	const updated: string[] = [];
	if (stale.length > 0) {
		console.error(
			`Scraping ${stale.length} stale case(s): ${stale.join(", ")}`,
		);
		const scraped = await scrapeCases(stale);

		for (const caseName of stale) {
			const result = scraped[caseName];
			if (!result) {
				console.error(`  warning: scraper returned no data for "${caseName}"`);
				continue;
			}
			if (!isUsableCase(result)) {
				console.error(
					`  warning: incomplete scrape for "${caseName}" (price ${result.price}, ` +
						`buckets ${BUCKETS.map((b) => `${b}=${result[b]?.length ?? 0}`).join(" ")}); skipping`,
				);
				continue;
			}
			local[caseName] = result;
			updated.push(caseName);
		}
	}

	const enriched = enrichInspectMetadata(local, skins);
	const scrapedAtChanged = file.scrapedAt !== scrapedAt;
	if (updated.length === 0 && enriched === 0 && !scrapedAtChanged) {
		console.error("Catalog is up to date. Nothing to write.");
		return;
	}

	await Bun.write(
		ASSET_PATH,
		`${JSON.stringify({ scrapedAt, cases: local }, null, 4)}\n`,
	);
	if (updated.length > 0) {
		console.error(`Updated ${updated.length} case(s): ${updated.join(", ")}`);
	}
	if (scrapedAtChanged) {
		console.error(`ByMykel last updated: ${scrapedAt}`);
	}
	console.error(`Added inspect metadata to ${enriched} skin entries.`);
}

if (import.meta.main) {
	await main();
}
