import { describe, expect, test } from "bun:test";
import AhoCorasick from "./ahoCorasick";

function naive(patterns: string[], text: string): Set<string> {
	return new Set(patterns.filter((pattern) => text.includes(pattern)));
}

describe("AhoCorasick", () => {
	test("finds overlapping and nested patterns in one pass", () => {
		const patterns = ["he", "she", "his", "hers"];
		const automaton = new AhoCorasick(patterns.map((p) => [p, p] as const));

		expect(automaton.search("ushers")).toEqual(new Set(["she", "he", "hers"]));
		expect(automaton.search("ahishers")).toEqual(
			new Set(["his", "she", "he", "hers"]),
		);
		expect(automaton.search("nothing here?")).toEqual(new Set(["he"]));
		expect(automaton.search("xyz")).toEqual(new Set());
	});

	test("reports matches found only through fail links", () => {
		const automaton = new AhoCorasick([
			["abcd", "abcd"],
			["bc", "bc"],
			["c", "c"],
		] as const);

		expect(automaton.search("abce")).toEqual(new Set(["bc", "c"]));
	});

	test("maps one pattern to several values and dedupes repeats", () => {
		const automaton = new AhoCorasick([
			["ping", 1],
			["ping", 2],
			["pong", 2],
		] as const);

		expect(automaton.search("ping pong ping")).toEqual(new Set([1, 2]));
	});

	test("is case-sensitive and handles astral code points", () => {
		const automaton = new AhoCorasick([
			["Hello", "hello"],
			["🦀 crab", "crab"],
		] as const);

		expect(automaton.search("hello")).toEqual(new Set());
		expect(automaton.search("a 🦀 crab says Hello")).toEqual(
			new Set(["hello", "crab"]),
		);
	});

	test("with no patterns matches nothing", () => {
		const automaton = new AhoCorasick<string>([]);
		expect(automaton.patternCount).toBe(0);
		expect(automaton.search("anything")).toEqual(new Set());
	});

	test("rejects empty patterns", () => {
		expect(() => new AhoCorasick([["", 1]])).toThrow("non-empty");
	});

	test("agrees with a naive search on random input", () => {
		const alphabet = "abc";
		const random = (length: number) =>
			Array.from(
				{ length },
				() => alphabet[Math.floor(Math.random() * alphabet.length)],
			).join("");

		for (let round = 0; round < 200; round++) {
			const patterns = [
				...new Set(
					Array.from({ length: 8 }, () =>
						random(1 + Math.floor(Math.random() * 4)),
					),
				),
			];
			const text = random(30);
			const automaton = new AhoCorasick(patterns.map((p) => [p, p] as const));
			expect(automaton.search(text)).toEqual(naive(patterns, text));
		}
	});
});
