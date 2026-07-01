import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Presence, VoiceState } from "discord.js";
import type { DeafenTrackerConfig } from "../config";
import type Bot from "../models/Bot";
import type DeafenSessionRepository from "../repositories/DeafenSessionRepository";
import DeafenTrackerService from "../services/DeafenTrackerService";
import PresenceUpdate from "./PresenceUpdate";

const DEFAULT_CONFIG: DeafenTrackerConfig = {
	enabled: true,
	muted_is_deafened: false,
	users: ["user-123"],
};

type PresenceOptions = {
	memberId?: string;
	guildId?: string;
	channelId: string | null;
	afkChannelId?: string | null;
	deaf?: boolean;
	status: string;
};

function createPresence(options: PresenceOptions): Presence {
	const guild = {
		id: options.guildId ?? "guild-123",
		afkChannelId: options.afkChannelId ?? null,
	};
	const member = {
		id: options.memberId ?? "user-123",
		guild,
		presence: { status: options.status },
	} as Record<string, unknown>;
	const voice = {
		id: member.id,
		channelId: options.channelId,
		deaf: options.deaf ?? false,
		mute: false,
		guild,
		member,
	} as unknown as VoiceState;
	member.voice = voice;

	return { member } as unknown as Presence;
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
		config: { get: () => config },
		deafenTracker,
	} as unknown as Bot;
}

describe("PresenceUpdate", () => {
	let repository: ReturnType<typeof createRepository>;
	let service: DeafenTrackerService;
	const event = new PresenceUpdate();

	beforeEach(() => {
		repository = createRepository();
		service = new DeafenTrackerService(repository);
	});

	test("ends a session when a deafened user goes idle", async () => {
		const bot = createBot(service);
		// Seed an active session by driving an online + deafened presence in first.
		const online = createPresence({
			channelId: "voice-1",
			deaf: true,
			status: "online",
		});
		await event.execute(bot, null, online);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);

		const idle = createPresence({
			channelId: "voice-1",
			deaf: true,
			status: "idle",
		});
		await event.execute(bot, null, idle);

		expect(repository.recordSession).toHaveBeenCalledTimes(1);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
	});

	test("starts a session when a deafened user becomes active again", async () => {
		const bot = createBot(service);
		const active = createPresence({
			channelId: "voice-1",
			deaf: true,
			status: "online",
		});

		await event.execute(bot, null, active);

		expect(repository.recordSession).not.toHaveBeenCalled();
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
	});

	test("ignores users not on the allowlist", async () => {
		const bot = createBot(service);
		const presence = createPresence({
			memberId: "user-999",
			channelId: "voice-1",
			deaf: true,
			status: "online",
		});

		await event.execute(bot, null, presence);

		expect(service.hasActiveSession("guild-123", "user-999")).toBe(false);
	});

	test("ignores presences with no voice channel", async () => {
		const bot = createBot(service);
		const presence = createPresence({
			channelId: null,
			deaf: true,
			status: "online",
		});

		await event.execute(bot, null, presence);

		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
	});
});
