import { describe, expect, mock, test } from "bun:test";
import { Collection, type GuildMember, type VoiceState } from "discord.js";
import type { KazagumoPlayer } from "kazagumo";
import type Bot from "../models/Bot";
import VoiceStateUpdate from "./VoiceStateUpdate";

type TestMember = Pick<GuildMember, "id" | "user">;

type TestVoiceChannel = {
	members: Collection<string, TestMember>;
};

type TestPlayer = Pick<KazagumoPlayer, "destroy" | "guildId" | "voiceId"> & {
	disconnect: ReturnType<typeof mock>;
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

function createPlayer(voiceId: string | null = "voice-123"): TestPlayer {
	return {
		guildId: "guild-123",
		voiceId,
		disconnect: mock(() => undefined),
		destroy: mock(async () => undefined),
	} as unknown as TestPlayer;
}

function createBot(player?: TestPlayer): Bot {
	return {
		user: {
			id: "bot-123",
		},
		music: {
			getPlayer: mock(() => player),
		},
	} as unknown as Bot;
}

describe("VoiceStateUpdate", () => {
	test("does nothing when the guild has no player", async () => {
		const event = new VoiceStateUpdate();
		const bot = createBot();
		const oldState = createVoiceState({
			channelId: "voice-123",
			channel: createChannel([createMember("bot-123", true)]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(bot.music.getPlayer).toHaveBeenCalledWith("guild-123");
	});

	test("destroys the player when a non-bot member leaves the player voice channel empty", async () => {
		const event = new VoiceStateUpdate();
		const player = createPlayer();
		const bot = createBot(player);
		const oldState = createVoiceState({
			channelId: "voice-123",
			channel: createChannel([createMember("bot-123", true)]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(player.destroy).toHaveBeenCalledTimes(1);
		expect(player.disconnect).not.toHaveBeenCalled();
	});

	test("keeps the player when another non-bot member remains in the voice channel", async () => {
		const event = new VoiceStateUpdate();
		const player = createPlayer();
		const bot = createBot(player);
		const oldState = createVoiceState({
			channelId: "voice-123",
			channel: createChannel([
				createMember("bot-123", true),
				createMember("user-456"),
			]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(player.destroy).not.toHaveBeenCalled();
		expect(player.disconnect).not.toHaveBeenCalled();
	});

	test("ignores voice updates outside the player voice channel", async () => {
		const event = new VoiceStateUpdate();
		const player = createPlayer("voice-123");
		const bot = createBot(player);
		const oldState = createVoiceState({
			channelId: "voice-456",
			channel: createChannel([createMember("bot-123", true)]),
		});
		const newState = createVoiceState({ channelId: null });

		await event.execute(bot, oldState, newState);

		expect(player.destroy).not.toHaveBeenCalled();
		expect(player.disconnect).not.toHaveBeenCalled();
	});

	test("destroys the player when an admin moves the bot into an empty voice channel", async () => {
		const event = new VoiceStateUpdate();
		const player = createPlayer();
		const bot = createBot(player);
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

		expect(player.destroy).toHaveBeenCalledTimes(1);
		expect(player.disconnect).not.toHaveBeenCalled();
	});

	test("keeps the player when an admin moves the bot into a non-empty voice channel", async () => {
		const event = new VoiceStateUpdate();
		const player = createPlayer();
		const bot = createBot(player);
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

		expect(player.destroy).not.toHaveBeenCalled();
		expect(player.disconnect).not.toHaveBeenCalled();
	});

	test("destroys without disconnecting when an admin disconnects the bot", async () => {
		const event = new VoiceStateUpdate();
		const player = createPlayer();
		const bot = createBot(player);
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

		expect(player.destroy).toHaveBeenCalledTimes(1);
		expect(player.disconnect).not.toHaveBeenCalled();
	});
});
