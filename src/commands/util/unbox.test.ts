import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { AutocompleteInteraction } from "discord.js";
import * as unboxHelpers from "../../helpers/unbox";
import Unbox from "./unbox";

function createInteraction(focused: string) {
	const respond = mock(
		async (_choices: { name: string; value: string }[]) => undefined,
	);
	const interaction = {
		options: { getFocused: () => focused },
		respond,
	} as unknown as AutocompleteInteraction;
	return { interaction, respond };
}

afterEach(() => {
	mock.restore();
});

describe("Unbox.autocomplete", () => {
	test("filters case names case-insensitively by substring", async () => {
		spyOn(unboxHelpers, "listCaseNames").mockResolvedValue([
			"Chroma Case",
			"Gamma Case",
			"Spectrum Case",
		]);
		const { interaction, respond } = createInteraction("ma");

		await new Unbox().autocomplete(interaction);

		expect(respond).toHaveBeenCalledWith([
			{ name: "Chroma Case", value: "Chroma Case" },
			{ name: "Gamma Case", value: "Gamma Case" },
		]);
	});

	test("caps results at 25", async () => {
		const names = Array.from({ length: 40 }, (_, i) => `Case ${i}`);
		spyOn(unboxHelpers, "listCaseNames").mockResolvedValue(names);
		const { interaction, respond } = createInteraction("case");

		await new Unbox().autocomplete(interaction);

		const choices = respond.mock.calls[0]?.[0] ?? [];
		expect(choices).toHaveLength(25);
	});

	test("returns all names (capped) for an empty focus", async () => {
		spyOn(unboxHelpers, "listCaseNames").mockResolvedValue([
			"A Case",
			"B Case",
		]);
		const { interaction, respond } = createInteraction("");

		await new Unbox().autocomplete(interaction);

		expect(respond).toHaveBeenCalledWith([
			{ name: "A Case", value: "A Case" },
			{ name: "B Case", value: "B Case" },
		]);
	});
});
