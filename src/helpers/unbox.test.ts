import { describe, expect, test } from "bun:test";
import { downgradeWear, getWear, rollRarity, roundHalfToEven } from "./unbox";

describe("unbox helpers", () => {
	test("maps wear buckets correctly", () => {
		expect(getWear(0.07)).toBe("Factory New");
		expect(getWear(0.08)).toBe("Minimal Wear");
		expect(getWear(0.16)).toBe("Field-Tested");
		expect(getWear(0.4)).toBe("Well-Worn");
		expect(getWear(0.5)).toBe("Battle-Scarred");
		expect(getWear(null)).toBe("Vanilla");
	});

	test("downgrades into the next wear range", () => {
		expect(downgradeWear(0.03, () => 0)).toBe(0.08);
		expect(downgradeWear(0.1, () => 0)).toBe(0.16);
		expect(downgradeWear(0.2, () => 0)).toBe(0.39);
		expect(downgradeWear(0.4, () => 0)).toBe(0.46);
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
	});
});
