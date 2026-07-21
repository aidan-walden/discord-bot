import { describe, expect, test } from "bun:test";
import type { CounterStrikeCaseDefinition } from "../src/models/CounterStrikeSkin";
import {
	type ByMykelSkin,
	enrichInspectMetadata,
	getBucket,
	isUsableCase,
	normalizeName,
} from "./update-skins";

describe("normalizeName", () => {
	test("strips ByMykel's leading star", () => {
		expect(normalizeName("★ Kukri Knife | Fade")).toBe("Kukri Knife | Fade");
	});

	test("collapses vanilla knives to match local form", () => {
		// ByMykel "★ Bayonet" and local "Bayonet | ★ (Vanilla)" must compare equal.
		expect(normalizeName("★ Bayonet")).toBe("Bayonet");
		expect(normalizeName("Bayonet | ★ (Vanilla)")).toBe("Bayonet");
		expect(normalizeName("Kukri Knife | ★ Vanilla")).toBe("Kukri Knife");
	});

	test("leaves ordinary skin names untouched", () => {
		expect(normalizeName("M4A1-S | Black Lotus")).toBe("M4A1-S | Black Lotus");
	});
});

describe("getBucket", () => {
	const make = (id: string, category: string): ByMykelSkin => ({
		name: "x",
		rarity: { id },
		category: { name: category },
		weapon: { weapon_id: 1 },
		paint_index: "1",
	});

	test("maps weapon rarities", () => {
		expect(getBucket(make("rarity_rare_weapon", "Rifles"))).toBe("blue");
		expect(getBucket(make("rarity_mythical_weapon", "Pistols"))).toBe("purple");
		expect(getBucket(make("rarity_legendary_weapon", "Rifles"))).toBe("pink");
	});

	test("rarity_ancient_weapon is red for weapons but gold for knives", () => {
		expect(getBucket(make("rarity_ancient_weapon", "Rifles"))).toBe("red");
		expect(getBucket(make("rarity_ancient_weapon", "Knives"))).toBe("gold");
	});

	test("gloves and untracked rarities", () => {
		expect(getBucket(make("rarity_ancient", "Gloves"))).toBe("gold");
		expect(getBucket(make("rarity_common_weapon", "Pistols"))).toBeNull();
	});
});

describe("enrichInspectMetadata", () => {
	test("adds IDs to gold skins and selects Doppler Phase 1", () => {
		const catalog = {
			"Test Case": {
				price: 1,
				blue: [],
				purple: [],
				pink: [],
				red: [],
				gold: [
					{
						name: "Karambit | Doppler",
						img: "",
						rarity: "Gold" as const,
						stattrak: true,
						pricing: {},
						minWear: 0,
						maxWear: 0.08,
					},
				],
			},
		};
		const base = {
			name: "★ Karambit | Doppler",
			rarity: { id: "rarity_ancient_weapon" },
			category: { name: "Knives" },
			weapon: { weapon_id: 507 },
			crates: [],
		};

		expect(
			enrichInspectMetadata(catalog, [
				{ ...base, paint_index: "417", phase: "Black Pearl" },
				{ ...base, paint_index: "418", phase: "Phase 1" },
			]),
		).toBe(1);
		expect(catalog["Test Case"].gold[0]).toMatchObject({
			defIndex: 507,
			paintIndex: 418,
		});
	});
});

describe("isUsableCase", () => {
	const skin = {
		name: "x",
		img: "",
		rarity: "Blue" as const,
		stattrak: false,
		pricing: {},
		minWear: 0,
		maxWear: 1,
	};
	const full = (): CounterStrikeCaseDefinition => ({
		price: 1,
		blue: [skin],
		purple: [skin],
		pink: [skin],
		red: [skin],
		gold: [skin],
	});

	test("accepts a fully-scraped case", () => {
		expect(isUsableCase(full())).toBe(true);
	});

	test("rejects empty gold bucket (would crash /unbox)", () => {
		expect(isUsableCase({ ...full(), gold: [] })).toBe(false);
	});

	test("rejects zero price", () => {
		expect(isUsableCase({ ...full(), price: 0 })).toBe(false);
	});
});
