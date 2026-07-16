import { describe, expect, mock, test } from "bun:test";
import {
	ApplicationCommandOptionType,
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
	MessageFlags,
} from "discord.js";
import TiktokTts, { resolveOutputMode, TIKTOK_VOICES } from "./tiktoktts";

function createAutocompleteInteraction(focused: string) {
	const respond = mock(
		async (_choices: { name: string; value: string }[]) => undefined,
	);
	return {
		interaction: {
			options: { getFocused: () => focused },
			respond,
		} as unknown as AutocompleteInteraction,
		respond,
	};
}

function createCommandInteraction(options: {
	sessionId?: string;
	player?: object;
}) {
	const reply = mock(async () => undefined);
	const deferReply = mock(async () => undefined);
	const getPlayer = mock(() => options.player);
	return {
		interaction: {
			options: {
				getString: (name: string) =>
					({ message: "Hello", voice: "Stormtrooper", mode: null })[name] ??
					null,
			},
			client: {
				bot: {
					config: {
						get: () => options.sessionId,
					},
					music: { getPlayer },
				},
			},
			inCachedGuild: () => true,
			member: {
				voice: {
					channel: { id: "voice-channel", joinable: true, speakable: true },
				},
			},
			guildId: "guild",
			reply,
			deferReply,
		} as unknown as ChatInputCommandInteraction,
		reply,
		deferReply,
		getPlayer,
	};
}

describe("TiktokTts", () => {
	test("defines the required command options", () => {
		const command = new TiktokTts().data.toJSON();
		expect(command.name).toBe("tiktoktts");
		expect(command.description).toBe("Creates TikTok text-to-speech audio");
		expect(command.options).toEqual([
			{
				type: ApplicationCommandOptionType.String,
				name: "message",
				description: "The text to speak",
				required: true,
			},
			{
				type: ApplicationCommandOptionType.String,
				name: "voice",
				description: "The TikTok voice to use",
				required: true,
				autocomplete: true,
			},
			{
				type: ApplicationCommandOptionType.String,
				name: "mode",
				description: "Where to play the audio",
				required: false,
				choices: [
					{ name: "Voice", value: "voice" },
					{ name: "Attachment", value: "attachment" },
				],
			},
		]);
	});

	test("contains every current upstream voice with unique friendly names", () => {
		expect(TIKTOK_VOICES).toHaveLength(108);
		expect(new Set(TIKTOK_VOICES.map(({ name }) => name)).size).toBe(108);
		expect(TIKTOK_VOICES).toContainEqual({
			name: "Stormtrooper",
			language: "Disney",
			apiValue: "en_us_stormtrooper",
		});
		expect(TIKTOK_VOICES).toContainEqual({
			name: "French - Male 1",
			language: "French",
			apiValue: "fr_001",
		});
		expect(TIKTOK_VOICES).toContainEqual({
			name: "Female",
			language: "Vietnamese",
			apiValue: "BV074_streaming",
		});
	});

	test("autocompletes friendly names case-insensitively", async () => {
		const { interaction, respond } = createAutocompleteInteraction("STORM");
		await new TiktokTts().autocomplete(interaction);
		expect(respond).toHaveBeenCalledWith([
			{ name: "Stormtrooper (Disney)", value: "Stormtrooper" },
		]);
	});

	test("autocompletes by language", async () => {
		const { interaction, respond } =
			createAutocompleteInteraction("vietnamese");
		await new TiktokTts().autocomplete(interaction);
		expect(respond).toHaveBeenCalledWith([
			{ name: "Female (Vietnamese)", value: "Female" },
			{ name: "Male (Vietnamese)", value: "Male" },
		]);
	});

	test("caps autocomplete responses at 25", async () => {
		for (const focused of ["", "english", "a"]) {
			const { interaction, respond } = createAutocompleteInteraction(focused);
			await new TiktokTts().autocomplete(interaction);
			expect(respond.mock.calls[0]?.[0].length).toBeLessThanOrEqual(25);
		}
	});

	test("reports missing TikTok configuration before generation", async () => {
		const { interaction, reply, deferReply } = createCommandInteraction({});
		await new TiktokTts().execute(interaction);
		expect(reply).toHaveBeenCalledWith({
			content: "TikTok TTS is not configured.",
			flags: MessageFlags.Ephemeral,
		});
		expect(deferReply).not.toHaveBeenCalled();
	});

	test("rejects voice output while music is active", async () => {
		const player = {};
		const { interaction, reply, deferReply, getPlayer } =
			createCommandInteraction({
				sessionId: "session",
				player,
			});
		await new TiktokTts().execute(interaction);
		expect(getPlayer).toHaveBeenCalledWith("guild");
		expect(reply).toHaveBeenCalledWith({
			content:
				"TikTok TTS cannot play while music is active. Choose attachment mode instead.",
			flags: MessageFlags.Ephemeral,
		});
		expect(deferReply).not.toHaveBeenCalled();
	});
});

describe("resolveOutputMode", () => {
	test.each([
		[null, false, "attachment"],
		["voice", false, "attachment"],
		["attachment", false, "attachment"],
		[null, true, "voice"],
		["voice", true, "voice"],
		["attachment", true, "attachment"],
	] as const)("resolves requested=%s canPlay=%s to %s", (requestedMode, canPlayInVoice, expected) => {
		expect(resolveOutputMode(requestedMode, canPlayInVoice)).toBe(expected);
	});
});
