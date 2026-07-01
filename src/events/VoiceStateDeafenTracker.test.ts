import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { VoiceState } from "discord.js";
import type { DeafenTrackerConfig } from "../config";
import type Bot from "../models/Bot";
import type DeafenSessionRepository from "../repositories/DeafenSessionRepository";
import DeafenTrackerService from "../services/DeafenTrackerService";
import VoiceStateDeafenTracker from "./VoiceStateDeafenTracker";

const DEFAULT_CONFIG: DeafenTrackerConfig = {
	enabled: true,
	muted_is_deafened: false,
	users: ["user-123"],
};

type VoiceStateOptions = {
	id?: string;
	guildId?: string;
	channelId: string | null;
	afkChannelId?: string | null;
	deaf?: boolean;
	mute?: boolean;
	presenceStatus?: string | null;
};

function createVoiceState(options: VoiceStateOptions): VoiceState {
	return {
		id: options.id ?? "user-123",
		channelId: options.channelId,
		deaf: options.deaf ?? false,
		mute: options.mute ?? false,
		guild: {
			id: options.guildId ?? "guild-123",
			afkChannelId: options.afkChannelId ?? null,
		},
		member:
			options.presenceStatus === undefined
				? null
				: { presence: { status: options.presenceStatus } },
	} as unknown as VoiceState;
}

function createRepository() {
	return {
		recordSession: mock(async () => null),
	} as unknown as DeafenSessionRepository & {
		recordSession: ReturnType<typeof mock>;
	};
}

function createBot(
	deafenTracker: DeafenTrackerService,
	config: DeafenTrackerConfig = DEFAULT_CONFIG,
): Bot {
	return {
		user: { id: "bot-123" },
		config: { get: () => config },
		deafenTracker,
	} as unknown as Bot;
}

describe("VoiceStateDeafenTracker", () => {
	let repository: ReturnType<typeof createRepository>;
	let service: DeafenTrackerService;
	const event = new VoiceStateDeafenTracker();

	beforeEach(() => {
		repository = createRepository();
		service = new DeafenTrackerService(repository);
	});

	test("starts a session when a tracked user deafens", async () => {
		const bot = createBot(service);
		const oldState = createVoiceState({ channelId: "voice-1", deaf: false });
		const newState = createVoiceState({ channelId: "voice-1", deaf: true });

		await event.execute(bot, oldState, newState);

		expect(repository.recordSession).not.toHaveBeenCalled();
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
	});

	test("ends and persists when a tracked user undeafens", async () => {
		const bot = createBot(service);
		const deafState = createVoiceState({ channelId: "voice-1", deaf: true });
		const undeafState = createVoiceState({ channelId: "voice-1", deaf: false });

		await event.execute(bot, undeafState, deafState); // start
		await event.execute(bot, deafState, undeafState); // end

		expect(repository.recordSession).toHaveBeenCalledTimes(1);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
	});

	test("does not count time in the AFK channel", async () => {
		const bot = createBot(service);
		const normal = createVoiceState({ channelId: "voice-1", deaf: false });
		const afkDeaf = createVoiceState({
			channelId: "afk-1",
			afkChannelId: "afk-1",
			deaf: true,
		});

		await event.execute(bot, normal, afkDeaf);

		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
	});

	test("respects muted_is_deafened for mute-only users", async () => {
		const undeaf = createVoiceState({ channelId: "voice-1", mute: false });
		const muted = createVoiceState({ channelId: "voice-1", mute: true });

		const offBot = createBot(service, { ...DEFAULT_CONFIG });
		await event.execute(offBot, undeaf, muted);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);

		const onService = new DeafenTrackerService(repository);
		const onBot = createBot(onService, {
			...DEFAULT_CONFIG,
			muted_is_deafened: true,
		});
		await event.execute(onBot, undeaf, muted);
		expect(onService.hasActiveSession("guild-123", "user-123")).toBe(true);
	});

	test("ends and persists when a tracked user leaves voice while deafened", async () => {
		const bot = createBot(service);
		const deafState = createVoiceState({ channelId: "voice-1", deaf: true });
		const leftState = createVoiceState({ channelId: null, deaf: true });

		await event.execute(
			bot,
			createVoiceState({ channelId: "voice-1" }),
			deafState,
		);
		await event.execute(bot, deafState, leftState);

		expect(repository.recordSession).toHaveBeenCalledTimes(1);
	});

	test("ignores the bot's own voice state", async () => {
		const bot = createBot(service);
		const oldState = createVoiceState({ id: "bot-123", channelId: "voice-1" });
		const newState = createVoiceState({
			id: "bot-123",
			channelId: "voice-1",
			deaf: true,
		});

		await event.execute(bot, oldState, newState);

		expect(service.hasActiveSession("guild-123", "bot-123")).toBe(false);
	});

	test("ignores users not on the allowlist", async () => {
		const bot = createBot(service);
		const oldState = createVoiceState({ id: "user-999", channelId: "voice-1" });
		const newState = createVoiceState({
			id: "user-999",
			channelId: "voice-1",
			deaf: true,
		});

		await event.execute(bot, oldState, newState);

		expect(service.hasActiveSession("guild-123", "user-999")).toBe(false);
	});

	test("isEnabled reflects config activeness", () => {
		expect(event.isEnabled(createBot(service, { ...DEFAULT_CONFIG }))).toBe(
			true,
		);
		expect(
			event.isEnabled(
				createBot(service, { ...DEFAULT_CONFIG, enabled: false }),
			),
		).toBe(false);
		expect(
			event.isEnabled(createBot(service, { ...DEFAULT_CONFIG, users: [] })),
		).toBe(false);
	});
});
