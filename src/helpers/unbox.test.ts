import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	clearCaseCatalogCache,
	downgradeWear,
	formatCurrency,
	formatRolledSkinsSummary,
	getRarityColor,
	getWear,
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

describe("unbox helpers", () => {
	afterEach(() => {
		spyOn(Bun, "file").mockRestore();
	});

	test("loadCaseCatalog rejects invalid catalog roots", async () => {
		const fileSpy = spyOn(Bun, "file").mockImplementation(
			() =>
				({
					text: async () => "[]",
				}) as ReturnType<typeof Bun.file>,
		);

		await expect(loadCaseCatalog()).rejects.toThrow(
			"Invalid skins.json: expected an object at root.",
		);
		fileSpy.mockRestore();
	});

	test("loadCaseCatalog returns the same cached object", async () => {
		const first = await loadCaseCatalog();
		const second = await loadCaseCatalog();

		expect(first).toBe(second);
	});

	test("runUnboxSimulation rejects empty catalogs", async () => {
		clearCaseCatalogCache();
		const fileSpy = spyOn(Bun, "file").mockImplementation(
			() =>
				({
					text: async () => "{}",
				}) as ReturnType<typeof Bun.file>,
		);

		expect(runUnboxSimulation(null, () => 0)).rejects.toThrow(
			"No cases are available in the catalog.",
		);

		fileSpy.mockRestore();
		clearCaseCatalogCache();
		await loadCaseCatalog();
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

	test("getRarityColor maps rarities to embed colors", () => {
		expect(getRarityColor("Red")).toBe(0xd95752);
		expect(getRarityColor("Pink")).toBe(0xc23ede);
		expect(getRarityColor("Purple")).toBe(0x7f4af6);
		expect(getRarityColor("Blue")).toBe(0x5168f6);
		expect(getRarityColor("Gold")).toBe(0xf9d849);
	});

	test("listCaseNames returns sorted case names", async () => {
		const caseNames = await listCaseNames();

		expect(caseNames.length).toBeGreaterThan(0);
		expect(caseNames).toEqual(
			[...caseNames].sort((left, right) => left.localeCompare(right)),
		);
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
		expect(runUnboxSimulation("Definitely Missing Case")).rejects.toThrow(
			"Unknown case: Definitely Missing Case",
		);
	});

	test("runUnboxSimulation completes when a gold skin resolves", async () => {
		const result = await runUnboxSimulation(
			"Kilowatt Case",
			createSeededRng([0.998, 0, 0.99, 0]),
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
	});

	test("runUnboxSimulation accumulates non-gold rolls before finishing", async () => {
		const result = await runUnboxSimulation(
			"Kilowatt Case",
			createSeededRng([0.2, 0, 0.99, 0, 0.998, 0, 0.99, 0]),
		);

		expect(result.rolls).toBe(2);
		expect(result.countsByRarity.Blue).toBe(1);
		expect(result.countsByRarity.Gold).toBe(1);
		expect(Object.keys(result.rolledSkins.Blue).length).toBe(1);
	});
});
