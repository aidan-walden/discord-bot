import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Collection, Guild, VoiceState } from "discord.js";
import type { DeafenTrackerConfig } from "../config";
import type Bot from "../models/Bot";
import type DeafenSessionRepository from "../repositories/DeafenSessionRepository";
import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";
import DeafenTrackerService from "../services/DeafenTrackerService";
import DeafenTrackerReady from "./DeafenTrackerReady";

const DEFAULT_CONFIG: DeafenTrackerConfig = {
	enabled: true,
	muted_is_deafened: false,
	users: ["user-123"],
};

function createRepository() {
	return {
		recordSession: mock(async () => null),
	} as unknown as DeafenSessionRepository & {
		recordSession: ReturnType<typeof mock>;
	};
}

function createTemporaryState() {
	const store = new Map<string, unknown>();
	const temporaryState = {
		store,
		get: async <T>(key: string): Promise<T | null> => {
			if (!store.has(key)) {
				return null;
			}
			return store.get(key) as T;
		},
		set: async (key: string, value: unknown) => {
			store.set(key, value);
		},
		delete: async (key: string) => {
			store.delete(key);
		},
	};
	return temporaryState as typeof temporaryState &
		Pick<TemporaryStateRepository, "get" | "set" | "delete">;
}

function createVoiceState(options: {
	id?: string;
	guildId?: string;
	channelId: string | null;
	deaf?: boolean;
	presenceStatus?: string;
}): VoiceState {
	return {
		id: options.id ?? "user-123",
		channelId: options.channelId,
		deaf: options.deaf ?? false,
		mute: false,
		guild: {
			id: options.guildId ?? "guild-123",
			afkChannelId: null,
		},
		member:
			options.presenceStatus === undefined
				? null
				: { presence: { status: options.presenceStatus } },
	} as unknown as VoiceState;
}

function createBot(
	deafenTracker: DeafenTrackerService,
	options: {
		config?: DeafenTrackerConfig;
		voiceState?: VoiceState | null;
	} = {},
): Bot {
	const config = options.config ?? DEFAULT_CONFIG;
	const voiceState =
		options.voiceState === undefined
			? createVoiceState({
					channelId: "voice-1",
					deaf: true,
					presenceStatus: "online",
				})
			: options.voiceState;
	const voiceStatesCache = {
		get: (userId: string) =>
			voiceState && voiceState.id === userId ? voiceState : undefined,
	};
	const guild = {
		id: "guild-123",
		voiceStates: { cache: voiceStatesCache },
	} as unknown as Guild;
	const guildsCache = {
		get: (guildId: string) => (guildId === "guild-123" ? guild : undefined),
	} as unknown as Collection<string, Guild>;

	return {
		config: { get: () => config },
		deafenTracker,
		guilds: { cache: guildsCache },
	} as unknown as Bot;
}

describe("DeafenTrackerReady", () => {
	let repository: ReturnType<typeof createRepository>;
	let temporaryState: ReturnType<typeof createTemporaryState>;
	let service: DeafenTrackerService;
	const event = new DeafenTrackerReady();

	beforeEach(() => {
		repository = createRepository();
		temporaryState = createTemporaryState();
		service = new DeafenTrackerService(repository, temporaryState);
	});

	test("isEnabled reflects config activeness", () => {
		expect(event.isEnabled(createBot(service))).toBe(true);
		expect(
			event.isEnabled(
				createBot(service, { config: { ...DEFAULT_CONFIG, enabled: false } }),
			),
		).toBe(false);
	});

	test("retains restored sessions that still qualify", async () => {
		temporaryState.store.set("deafen:active-sessions", [
			{
				userId: "user-123",
				guildId: "guild-123",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		await service.initialize();
		const bot = createBot(service);

		await event.execute(bot);

		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
		expect(repository.recordSession).not.toHaveBeenCalled();
	});

	test("finishes restored sessions that no longer qualify", async () => {
		temporaryState.store.set("deafen:active-sessions", [
			{
				userId: "user-123",
				guildId: "guild-123",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		await service.initialize();
		const bot = createBot(service, { voiceState: null });

		await event.execute(bot);

		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
		expect(repository.recordSession).toHaveBeenCalledTimes(1);
	});
});
