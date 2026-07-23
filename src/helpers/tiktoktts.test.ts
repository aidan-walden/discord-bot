import { describe, expect, mock, test } from "bun:test";
import {
	createTikTokSpeechOgg,
	isTikTokCredentialRejection,
	releaseTtsVoice,
	resolveOutputMode,
	TIKTOK_VOICES,
} from "./tiktoktts";

describe("TIKTOK_VOICES", () => {
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
});

describe("resolveOutputMode", () => {
	test.each([
		[null, false, "attachment"],
		["voice", false, "attachment"],
		["attachment", false, "attachment"],
		[null, true, "voice"],
		["voice", true, "voice"],
		["attachment", true, "attachment"],
	] as const)(
		"resolves requested=%s canPlay=%s to %s",
		(requestedMode, canPlayInVoice, expected) => {
			expect(resolveOutputMode(requestedMode, canPlayInVoice)).toBe(expected);
		},
	);
});

describe("isTikTokCredentialRejection", () => {
	test("recognizes invalid and missing session responses", () => {
		expect(
			isTikTokCredentialRejection(
				new Error(
					"tiktok-tts Error: Your TikTok session id might be invalid or expired. Try getting a new one. status_code: 1",
				),
			),
		).toBe(true);
		expect(
			isTikTokCredentialRejection(
				new Error("tiktok-tts Error: No session id found. status_code: 5"),
			),
		).toBe(true);
	});

	test("ignores content and speaker errors", () => {
		expect(
			isTikTokCredentialRejection(
				new Error("The provided text is too long. status_code: 2"),
			),
		).toBe(false);
	});
});

describe("releaseTtsVoice", () => {
	test("is a no-op when the guild has no TTS session", () => {
		expect(() => releaseTtsVoice("guild-no-session")).not.toThrow();
	});
});

describe("createTikTokSpeechOgg", () => {
	test("records a credential rejection after exhausting every base URL", async () => {
		const recordCredentialRejection = mock(() => undefined);
		const audioCreator = mock(async () => {
			throw new Error(
				"tiktok-tts Error: Your TikTok session id might be invalid or expired.",
			);
		});

		await expect(
			createTikTokSpeechOgg(
				"session-id",
				"hello",
				"en_us_002",
				{ recordCredentialRejection },
				audioCreator,
			),
		).rejects.toThrow("session id might be invalid or expired");
		expect(audioCreator).toHaveBeenCalledTimes(5);
		expect(recordCredentialRejection).toHaveBeenCalledTimes(1);
		expect(recordCredentialRejection).toHaveBeenCalledWith("tiktok");
	});
});
