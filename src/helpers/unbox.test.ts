import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type {
	CounterStrikeCaseCatalog,
	CounterStrikeCaseDefinition,
	ScrapedSkin,
} from "../models/CounterStrikeSkin";
import {
	clearCaseCatalogCache,
	createInGameInspectUrl,
	createPreviewHex,
	downgradeWear,
	formatCurrency,
	formatRolledSkinsSummary,
	getRarityColor,
	getWear,
	isUnboxCatalogAvailable,
	listCaseNames,
	loadCaseCatalog,
	rollRarity,
	roundHalfToEven,
	runUnboxSimulation,
} from "./unbox";

function createSeededRng(values: number[]) {
	let index = 0;
	return () => {
		const value = values[index];
		index++;
		if (value === undefined) {
			throw new Error("Seeded RNG exhausted.");
		}
		return value;
	};
}

function createSkin(rarity: ScrapedSkin["rarity"], name: string): ScrapedSkin {
	return {
		name,
		img: `https://example.test/${name}.png`,
		rarity,
		stattrak: true,
		pricing: {
			"Factory New": 10,
			"Minimal Wear": 9,
			"Field-Tested": 8,
			"Well-Worn": 7,
			"Battle-Scarred": 6,
			Vanilla: 5,
			"StatTrak Factory New": 20,
			"StatTrak Minimal Wear": 19,
			"StatTrak Field-Tested": 18,
			"StatTrak Well-Worn": 17,
			"StatTrak Battle-Scarred": 16,
			"StatTrak Vanilla": 15,
		},
		minWear: 0,
		maxWear: 0.07,
	};
}

function createCaseDefinition(
	name: string,
	price: number,
): CounterStrikeCaseDefinition {
	return {
		price,
		blue: [createSkin("Blue", `${name} Blue`)],
		purple: [createSkin("Purple", `${name} Purple`)],
		pink: [createSkin("Pink", `${name} Pink`)],
		red: [createSkin("Red", `${name} Red`)],
		gold: [createSkin("Gold", `${name} Gold`)],
	};
}

function createCatalogFixture(): CounterStrikeCaseCatalog {
	return {
		"Zulu Case": createCaseDefinition("Zulu", 1.25),
		"Kilowatt Case": createCaseDefinition("Kilowatt", 2),
	};
}

function mockSkinsJsonText(fileContents: string): void {
	clearCaseCatalogCache();
	spyOn(Bun, "file").mockImplementation(
		() =>
			({
				text: async () => fileContents,
			}) as ReturnType<typeof Bun.file>,
	);
}

const FIXTURE_SCRAPED_AT = 1_700_000_000;

function mockSkinsJson(catalog: CounterStrikeCaseCatalog): void {
	mockSkinsJsonText(
		JSON.stringify({ scrapedAt: FIXTURE_SCRAPED_AT, cases: catalog }),
	);
}

describe("unbox helpers", () => {
	afterEach(() => {
		clearCaseCatalogCache();
		spyOn(Bun, "file").mockRestore();
	});

	test("loadCaseCatalog rejects invalid catalog roots", async () => {
		mockSkinsJsonText("[]");

		expect(loadCaseCatalog()).rejects.toThrow(
			"Invalid skins.json: expected an object at root.",
		);
	});

	test("loadCaseCatalog rejects bare case maps", async () => {
		mockSkinsJsonText(JSON.stringify(createCatalogFixture()));

		expect(loadCaseCatalog()).rejects.toThrow(
			"Invalid skins.json: expected { scrapedAt: number, cases: object }.",
		);
	});

	test("loadCaseCatalog returns the same cached object", async () => {
		mockSkinsJson(createCatalogFixture());

		const first = await loadCaseCatalog();
		const second = await loadCaseCatalog();

		expect(first).toBe(second);
	});

	test("isUnboxCatalogAvailable is false for invalid JSON", async () => {
		mockSkinsJsonText("[]");

		expect(await isUnboxCatalogAvailable()).toBe(false);
	});

	test("isUnboxCatalogAvailable is false when the file read fails", async () => {
		clearCaseCatalogCache();
		spyOn(Bun, "file").mockImplementation(
			() =>
				({
					text: async (): Promise<string> => {
						throw new Error("ENOENT");
					},
				}) as ReturnType<typeof Bun.file>,
		);

		expect(await isUnboxCatalogAvailable()).toBe(false);
	});

	test("isUnboxCatalogAvailable is true for a valid catalog", async () => {
		mockSkinsJson(createCatalogFixture());

		expect(await isUnboxCatalogAvailable()).toBe(true);
	});

	test("runUnboxSimulation rejects empty catalogs", async () => {
		mockSkinsJson({});

		expect(runUnboxSimulation(null, () => 0)).rejects.toThrow(
			"No cases are available in the catalog.",
		);
	});

	test("maps wear buckets correctly", () => {
		expect(getWear(0.07)).toBe("Factory New");
		expect(getWear(0.08)).toBe("Minimal Wear");
		expect(getWear(0.16)).toBe("Field-Tested");
		expect(getWear(0.4)).toBe("Well-Worn");
		expect(getWear(0.5)).toBe("Battle-Scarred");
		expect(getWear(null)).toBe("Vanilla");
		expect(getWear(1.1)).toBeNull();
		expect(getWear(-0.1)).toBeNull();
	});

	test("downgrades into the next wear range", () => {
		expect(downgradeWear(0.03, () => 0)).toBe(0.08);
		expect(downgradeWear(0.1, () => 0)).toBe(0.16);
		expect(downgradeWear(0.2, () => 0)).toBe(0.39);
		expect(downgradeWear(0.4, () => 0)).toBe(0.46);
		expect(downgradeWear(0.5, () => 0)).toBe(0);
	});

	test("rarity roll thresholds match the legacy odds", () => {
		expect(rollRarity(() => 0.2)).toBe("blue");
		expect(rollRarity(() => 0.81)).toBe("purple");
		expect(rollRarity(() => 0.97)).toBe("pink");
		expect(rollRarity(() => 0.994)).toBe("red");
		expect(rollRarity(() => 0.998)).toBe("gold");
	});

	test("profit rounding matches bankers rounding", () => {
		expect(roundHalfToEven(1.005, 2)).toBe(1);
		expect(roundHalfToEven(1.015, 2)).toBe(1.01);
		expect(roundHalfToEven(1.025, 2)).toBe(1.02);
		expect(roundHalfToEven(2.5, 0)).toBe(2);
	});

	test("formatCurrency formats USD values", () => {
		expect(formatCurrency(12.5)).toBe("$12.50");
	});

	test("encodes the documented preview payload", () => {
		expect(
			createPreviewHex({
				defIndex: 33,
				paintIndex: 1436,
				rarity: 4,
				wear: 0,
				paintSeed: 1,
			}),
		).toBe("001821209C0B280438004001AB6C9FD4");
	});

	test("builds an HTTPS wrapper for an inspect link", () => {
		const url = createInGameInspectUrl(
			{
				name: "Kukri Knife | Fade",
				stattrak: true,
				floatValue: 0.01,
				wear: "Factory New",
				price: 1,
				rarity: "Gold",
				imageUrl: "",
				defIndex: 526,
				paintIndex: 38,
			},
			123,
		);

		expect(url).not.toBeNull();
		expect(new URL(url as string).searchParams.get("apply")).toStartWith(
			"steam://rungame/730/76561202255233023/+csgo_econ_action_preview 00",
		);
	});

	test("getRarityColor maps rarities to embed colors", () => {
		expect(getRarityColor("Red")).toBe(0xd95752);
		expect(getRarityColor("Pink")).toBe(0xc23ede);
		expect(getRarityColor("Purple")).toBe(0x7f4af6);
		expect(getRarityColor("Blue")).toBe(0x5168f6);
		expect(getRarityColor("Gold")).toBe(0xf9d849);
	});

	test("listCaseNames returns sorted case names", async () => {
		mockSkinsJson(createCatalogFixture());

		const caseNames = await listCaseNames();

		expect(caseNames).toEqual(["Kilowatt Case", "Zulu Case"]);
	});

	test("formatRolledSkinsSummary renders rarity sections", () => {
		const summary = formatRolledSkinsSummary({
			Blue: { "AK-47 | Blue": 2 },
			Purple: {},
			Pink: { "AWP | Pink": 1 },
			Red: {},
			Gold: {},
		});

		expect(summary).toContain("Blues:");
		expect(summary).toContain("2x AK-47 | Blue");
		expect(summary).toContain("Purples:");
		expect(summary).toContain("\tNone");
		expect(summary).toContain("1x AWP | Pink");
		expect(summary.startsWith("```")).toBe(true);
		expect(summary.endsWith("```")).toBe(true);
	});

	test("runUnboxSimulation rejects unknown cases", async () => {
		mockSkinsJson(createCatalogFixture());

		expect(runUnboxSimulation("Definitely Missing Case")).rejects.toThrow(
			"Unknown case: Definitely Missing Case",
		);
	});

	test("runUnboxSimulation completes when a gold skin resolves", async () => {
		mockSkinsJson(createCatalogFixture());

		const result = await runUnboxSimulation(
			"Kilowatt Case",
			createSeededRng([0.998, 0, 0.99, 0, 0]),
		);

		expect(result.caseName).toBe("Kilowatt Case");
		expect(result.rolls).toBe(1);
		expect(result.finalSkin.rarity).toBe("Gold");
		expect(result.countsByRarity.Gold).toBe(1);
		expect(result.totalSpent).toBeGreaterThan(0);
		expect(result.profit).toBe(
			roundHalfToEven(result.totalGained - result.totalSpent, 2),
		);
		expect(result.profitCents).toBe(Math.round(result.profit * 100));
		expect(result.paintSeed).toBe(1);
		expect(result.scrapedAt).toBe(FIXTURE_SCRAPED_AT);
	});

	test("runUnboxSimulation accumulates non-gold rolls before finishing", async () => {
		mockSkinsJson(createCatalogFixture());

		const result = await runUnboxSimulation(
			"Kilowatt Case",
			createSeededRng([0.2, 0, 0.99, 0, 0.998, 0, 0.99, 0, 0]),
		);

		expect(result.rolls).toBe(2);
		expect(result.countsByRarity.Blue).toBe(1);
		expect(result.countsByRarity.Gold).toBe(1);
		expect(Object.keys(result.rolledSkins.Blue).length).toBe(1);
	});
});
