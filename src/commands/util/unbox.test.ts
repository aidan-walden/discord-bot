import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
	MessageFlags,
} from "discord.js";
import * as unboxHelpers from "../../helpers/unbox";
import Unbox from "./unbox";

function createAutocompleteInteraction(focused: string) {
	const respond = mock(
		async (_choices: { name: string; value: string }[]) => undefined,
	);
	const interaction = {
		options: { getFocused: () => focused },
		respond,
	} as unknown as AutocompleteInteraction;
	return { interaction, respond };
}

function createExecuteInteraction() {
	const reply = mock(async (_options: unknown) => undefined);
	const deferReply = mock(async () => undefined);
	const interaction = {
		options: { getString: () => null },
		reply,
		deferReply,
		user: { id: "user-1" },
		client: {
			bot: {
				balances: {
					applyProfit: mock(async () => ({
						balanceCents: 0,
						mostGainedCents: 0,
						mostLostCents: 0,
					})),
				},
			},
		},
	} as unknown as ChatInputCommandInteraction;
	return { interaction, reply, deferReply };
}

afterEach(() => {
	mock.restore();
});

describe("Unbox.autocomplete", () => {
	test("filters case names case-insensitively by substring", async () => {
		spyOn(unboxHelpers, "isUnboxCatalogAvailable").mockResolvedValue(true);
		spyOn(unboxHelpers, "listCaseNames").mockResolvedValue([
			"Chroma Case",
			"Gamma Case",
			"Spectrum Case",
		]);
		const { interaction, respond } = createAutocompleteInteraction("ma");

		await new Unbox().autocomplete(interaction);

		expect(respond).toHaveBeenCalledWith([
			{ name: "Chroma Case", value: "Chroma Case" },
			{ name: "Gamma Case", value: "Gamma Case" },
		]);
	});

	test("caps results at 25", async () => {
		spyOn(unboxHelpers, "isUnboxCatalogAvailable").mockResolvedValue(true);
		const names = Array.from({ length: 40 }, (_, i) => `Case ${i}`);
		spyOn(unboxHelpers, "listCaseNames").mockResolvedValue(names);
		const { interaction, respond } = createAutocompleteInteraction("case");

		await new Unbox().autocomplete(interaction);

		const choices = respond.mock.calls[0]?.[0] ?? [];
		expect(choices).toHaveLength(25);
	});

	test("returns all names (capped) for an empty focus", async () => {
		spyOn(unboxHelpers, "isUnboxCatalogAvailable").mockResolvedValue(true);
		spyOn(unboxHelpers, "listCaseNames").mockResolvedValue([
			"A Case",
			"B Case",
		]);
		const { interaction, respond } = createAutocompleteInteraction("");

		await new Unbox().autocomplete(interaction);

		expect(respond).toHaveBeenCalledWith([
			{ name: "A Case", value: "A Case" },
			{ name: "B Case", value: "B Case" },
		]);
	});

	test("responds empty when the catalog is unavailable", async () => {
		spyOn(unboxHelpers, "isUnboxCatalogAvailable").mockResolvedValue(false);
		const listCaseNames = spyOn(unboxHelpers, "listCaseNames");
		const { interaction, respond } = createAutocompleteInteraction("ma");

		await new Unbox().autocomplete(interaction);

		expect(respond).toHaveBeenCalledWith([]);
		expect(listCaseNames).not.toHaveBeenCalled();
	});
});

describe("Unbox.execute", () => {
	test("refuses when the catalog is unavailable", async () => {
		spyOn(unboxHelpers, "isUnboxCatalogAvailable").mockResolvedValue(false);
		const runUnboxSimulation = spyOn(unboxHelpers, "runUnboxSimulation");
		const { interaction, reply, deferReply } = createExecuteInteraction();

		await new Unbox().execute(interaction);

		expect(reply).toHaveBeenCalledWith({
			content:
				"CS skins catalog unavailable (assets/skins.json missing or invalid).",
			flags: MessageFlags.Ephemeral,
		});
		expect(deferReply).not.toHaveBeenCalled();
		expect(runUnboxSimulation).not.toHaveBeenCalled();
	});
});
