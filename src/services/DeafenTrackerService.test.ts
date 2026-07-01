import { describe, expect, mock, test } from "bun:test";
import type { VoiceState } from "discord.js";
import type DeafenSessionRepository from "../repositories/DeafenSessionRepository";
import DeafenTrackerService, {
	isDeafenTrackerActive,
} from "./DeafenTrackerService";

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

describe("isDeafenTrackerActive", () => {
	test("true only when enabled and users non-empty", () => {
		expect(
			isDeafenTrackerActive({
				enabled: true,
				muted_is_deafened: false,
				users: ["a"],
			}),
		).toBe(true);
		expect(
			isDeafenTrackerActive({
				enabled: false,
				muted_is_deafened: false,
				users: ["a"],
			}),
		).toBe(false);
		expect(
			isDeafenTrackerActive({
				enabled: true,
				muted_is_deafened: false,
				users: [],
			}),
		).toBe(false);
	});
});

describe("DeafenTrackerService.isCounting", () => {
	const service = new DeafenTrackerService(createRepository());

	test("counts a deafened user in a normal channel", () => {
		const state = createVoiceState({ channelId: "voice-1", deaf: true });
		expect(service.isCounting(state, false)).toBe(true);
	});

	test("does not count when not in a voice channel", () => {
		const state = createVoiceState({ channelId: null, deaf: true });
		expect(service.isCounting(state, false)).toBe(false);
	});

	test("does not count a deafened user in the AFK channel", () => {
		const state = createVoiceState({
			channelId: "afk-1",
			afkChannelId: "afk-1",
			deaf: true,
		});
		expect(service.isCounting(state, false)).toBe(false);
	});

	test("does not count a deafened user who is idle", () => {
		const state = createVoiceState({
			channelId: "voice-1",
			deaf: true,
			presenceStatus: "idle",
		});
		expect(service.isCounting(state, false)).toBe(false);
	});

	test("counts a deafened user who is online", () => {
		const state = createVoiceState({
			channelId: "voice-1",
			deaf: true,
			presenceStatus: "online",
		});
		expect(service.isCounting(state, false)).toBe(true);
	});

	test("mute-only respects muted_is_deafened", () => {
		const state = createVoiceState({ channelId: "voice-1", mute: true });
		expect(service.isCounting(state, false)).toBe(false);
		expect(service.isCounting(state, true)).toBe(true);
	});
});

describe("DeafenTrackerService.applyTransition", () => {
	function fixedClock(dates: [Date, ...Date[]]): () => Date {
		let index = 0;
		return () => dates[Math.min(index++, dates.length - 1)] ?? dates[0];
	}

	test("false -> true starts a session without persisting", async () => {
		const repository = createRepository();
		const service = new DeafenTrackerService(repository);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, false, true);

		expect(repository.recordSession).not.toHaveBeenCalled();
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
	});

	test("true -> false persists with the correct timestamps", async () => {
		const repository = createRepository();
		const startedAt = new Date("2026-01-01T00:00:00.000Z");
		const endedAt = new Date("2026-01-01T00:05:00.000Z");
		const service = new DeafenTrackerService(
			repository,
			fixedClock([startedAt, endedAt]),
		);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, false, true);
		await service.applyTransition(state, true, false);

		expect(repository.recordSession).toHaveBeenCalledTimes(1);
		expect(repository.recordSession).toHaveBeenCalledWith(
			"user-123",
			"guild-123",
			startedAt,
			endedAt,
		);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
	});

	test("no boundary crossed persists nothing", async () => {
		const repository = createRepository();
		const service = new DeafenTrackerService(repository);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, true, true);
		await service.applyTransition(state, false, false);

		expect(repository.recordSession).not.toHaveBeenCalled();
	});

	test("ending with no active session persists nothing", async () => {
		const repository = createRepository();
		const service = new DeafenTrackerService(repository);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, true, false);

		expect(repository.recordSession).not.toHaveBeenCalled();
	});
});
