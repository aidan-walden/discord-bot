import { describe, expect, test } from "bun:test";
import { assignSecretSanta } from "./secretSantaAssign";

function pairsFromMap(map: Map<string, string>): [string, string][] {
	return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

describe("assignSecretSanta", () => {
	test("null for fewer than 2 participants", () => {
		expect(assignSecretSanta([])).toBeNull();
		expect(assignSecretSanta(["a"])).toBeNull();
	});

	test("null for duplicate participant ids", () => {
		expect(assignSecretSanta(["a", "a"])).toBeNull();
	});

	test("n=2 swaps", () => {
		const result = assignSecretSanta(["a", "b"], [], () => 0);
		expect(result).not.toBeNull();
		expect(result?.get("a")).toBe("b");
		expect(result?.get("b")).toBe("a");
	});

	test("n=2 mutual exclude is impossible", () => {
		expect(assignSecretSanta(["a", "b"], [["a", "b"]])).toBeNull();
	});

	test("no self-gifts and full bijection", () => {
		const ids = ["a", "b", "c", "d", "e"];
		for (let seed = 0; seed < 20; seed++) {
			let state = seed + 1;
			const rng = () => {
				state = (state * 1103515245 + 12345) & 0x7fffffff;
				return state / 0x7fffffff;
			};
			const result = assignSecretSanta(ids, [], rng);
			expect(result).not.toBeNull();
			if (!result) {
				continue;
			}
			expect(result.size).toBe(ids.length);
			const recipients = [...result.values()];
			expect(new Set(recipients).size).toBe(ids.length);
			for (const [g, r] of result) {
				expect(g).not.toBe(r);
				expect(ids).toContain(g);
				expect(ids).toContain(r);
			}
		}
	});

	test("respects exclusions", () => {
		// n=3 + one mutual exclude is impossible (only 3-cycles, both use every edge pair)
		const ids = ["a", "b", "c", "d"];
		const result = assignSecretSanta(ids, [["a", "b"]], () => 0);
		expect(result).not.toBeNull();
		if (!result) {
			return;
		}
		expect(result.get("a")).not.toBe("b");
		expect(result.get("b")).not.toBe("a");
	});

	test("full clique exclude is impossible", () => {
		const ids = ["a", "b", "c"];
		expect(
			assignSecretSanta(ids, [
				["a", "b"],
				["a", "c"],
				["b", "c"],
			]),
		).toBeNull();
	});

	test("person excluded from everyone is impossible", () => {
		const ids = ["a", "b", "c", "d"];
		expect(
			assignSecretSanta(ids, [
				["a", "b"],
				["a", "c"],
				["a", "d"],
			]),
		).toBeNull();
	});

	test("ignores exclusions involving non-participants", () => {
		const result = assignSecretSanta(["a", "b"], [["a", "z"]], () => 0);
		expect(pairsFromMap(result as Map<string, string>)).toEqual([
			["a", "b"],
			["b", "a"],
		]);
	});
});
