import { describe, expect, mock, test } from "bun:test";
import { Collection, type GuildMember, type VoiceState } from "discord.js";
import type Bot from "../models/Bot";
import VoiceStateUpdate from "./VoiceStateUpdate";

type TestMember = Pick<GuildMember, "id" | "user">;

type TestVoiceChannel = {
	members: Collection<string, TestMember>;
};

type TestVoice = {
	getOwner: ReturnType<typeof mock>;
	getVoiceChannelId: ReturnType<typeof mock>;
	leave: ReturnType<typeof mock>;
};

function createMember(id: string, bot: boolean = false): TestMember {
	return {
		id,
		user: {
			bot,
		},
	} as TestMember;
}

function createChannel(members: TestMember[]): TestVoiceChannel {
	return {
		members: new Collection(members.map((member) => [member.id, member])),
	};
}

function createVoiceState(options: {
	id?: string;
	guildId?: string;
	channelId: string | null;
	channel?: TestVoiceChannel | null;
}): VoiceState {
	return {
		id: options.id ?? "user-123",
		guild: {
			id: options.guildId ?? "guild-123",
		},
		channelId: options.channelId,
		channel: options.channel ?? null,
	} as unknown as VoiceState;
}

function createVoice(
	owner: "music" | "tts" | "none" = "music",
	channelId: string | null = "voice-123",
): TestVoice {
	return {
		getOwner: mock(() => owner),
		getVoiceChannelId: mock(() => channelId),
		leave: mock(async () => undefined),
	};
}

function createBot(voice: TestVoice): Bot {
	return {
		user: {
			id: "bot-123",
		},
		voiceSessions: voice,
	} as unknown as Bot;
}

describe("VoiceStateUpdate", () => {
	test("does nothing when the guild has no voice session", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice("none", null);
		const bot = createBot(voice);
		const oldState = createVoiceState({
			channelId: "voice-123",
			channel: createChannel([createMember("bot-123", true)]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(voice.getOwner).toHaveBeenCalledWith("guild-123");
		expect(voice.leave).not.toHaveBeenCalled();
	});

	test("leaves voice when a non-bot member leaves the bot voice channel empty", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice();
		const bot = createBot(voice);
		const oldState = createVoiceState({
			channelId: "voice-123",
			channel: createChannel([createMember("bot-123", true)]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(voice.leave).toHaveBeenCalledWith("guild-123");
	});

	test("stays in voice when another non-bot member remains in the voice channel", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice();
		const bot = createBot(voice);
		const oldState = createVoiceState({
			channelId: "voice-123",
			channel: createChannel([
				createMember("bot-123", true),
				createMember("user-456"),
			]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(voice.leave).not.toHaveBeenCalled();
	});

	test("ignores voice updates outside the bot voice channel", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice("music", "voice-123");
		const bot = createBot(voice);
		const oldState = createVoiceState({
			channelId: "voice-456",
			channel: createChannel([createMember("bot-123", true)]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(voice.leave).not.toHaveBeenCalled();
	});

	test("leaves voice when an admin moves the bot into an empty voice channel", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice();
		const bot = createBot(voice);
		const oldState = createVoiceState({
			id: "bot-123",
			channelId: "voice-123",
			channel: createChannel([createMember("user-123")]),
		});
		const newState = createVoiceState({
			id: "bot-123",
			channelId: "voice-456",
			channel: createChannel([createMember("bot-123", true)]),
		});

		await event.execute(bot, oldState, newState);

		expect(voice.leave).toHaveBeenCalledWith("guild-123");
	});

	test("stays in voice when an admin moves the bot into a non-empty voice channel", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice();
		const bot = createBot(voice);
		const oldState = createVoiceState({
			id: "bot-123",
			channelId: "voice-123",
			channel: createChannel([createMember("user-123")]),
		});
		const newState = createVoiceState({
			id: "bot-123",
			channelId: "voice-456",
			channel: createChannel([
				createMember("bot-123", true),
				createMember("user-456"),
			]),
		});

		await event.execute(bot, oldState, newState);

		expect(voice.leave).not.toHaveBeenCalled();
	});

	test("leaves when an admin disconnects the bot", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice();
		const bot = createBot(voice);
		const oldState = createVoiceState({
			id: "bot-123",
			channelId: "voice-123",
			channel: createChannel([createMember("bot-123", true)]),
		});
		const newState = createVoiceState({
			id: "bot-123",
			channelId: null,
		});

		await event.execute(bot, oldState, newState);

		expect(voice.leave).toHaveBeenCalledWith("guild-123");
	});

	test("leaves a TTS session when the last non-bot member leaves its channel", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice("tts", "voice-123");
		const bot = createBot(voice);
		const oldState = createVoiceState({
			channelId: "voice-123",
			channel: createChannel([createMember("bot-123", true)]),
		});

		await event.execute(bot, oldState, createVoiceState({ channelId: null }));

		expect(voice.leave).toHaveBeenCalledWith("guild-123");
	});

	test("leaves a TTS session when the bot is moved into an empty channel", async () => {
		const event = new VoiceStateUpdate();
		const voice = createVoice("tts", "voice-123");
		const bot = createBot(voice);
		const oldState = createVoiceState({
			id: "bot-123",
			channelId: "voice-123",
			channel: createChannel([createMember("user-123")]),
		});
		const newState = createVoiceState({
			id: "bot-123",
			channelId: "voice-456",
			channel: createChannel([createMember("bot-123", true)]),
		});

		await event.execute(bot, oldState, newState);

		expect(voice.leave).toHaveBeenCalledWith("guild-123");
	});
});
