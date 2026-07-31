import { describe, expect, mock, test } from "bun:test";
import type { VoiceState } from "discord.js";
import type DeafenSessionRepository from "../repositories/DeafenSessionRepository";
import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";
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
		set: mock(async (key: string, value: unknown) => {
			store.set(key, value);
		}),
		delete: mock(async (key: string) => {
			store.delete(key);
		}),
	};
	return temporaryState as typeof temporaryState &
		Pick<TemporaryStateRepository, "get" | "set" | "delete">;
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
	const service = new DeafenTrackerService(
		createRepository(),
		createTemporaryState(),
	);

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

	test("false -> true starts a session without persisting postgres", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		const service = new DeafenTrackerService(repository, temporaryState);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, false, true);

		expect(repository.recordSession).not.toHaveBeenCalled();
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
		expect(temporaryState.store.get("deafen:active-sessions")).toEqual([
			{
				userId: "user-123",
				guildId: "guild-123",
				startedAt: expect.any(String),
			},
		]);
	});

	test("true -> false persists postgres before clearing temporary state", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		const startedAt = new Date("2026-01-01T00:00:00.000Z");
		const endedAt = new Date("2026-01-01T00:05:00.000Z");
		const order: string[] = [];
		repository.recordSession = mock(async () => {
			order.push("postgres");
			return null;
		});
		temporaryState.set = mock(async (key: string, value: unknown) => {
			order.push(`set:${key}`);
			temporaryState.store.set(key, value);
		});
		temporaryState.delete = mock(async (key: string) => {
			order.push(`delete:${key}`);
			temporaryState.store.delete(key);
		});
		const service = new DeafenTrackerService(
			repository,
			temporaryState,
			fixedClock([startedAt, endedAt]),
		);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, false, true);
		order.length = 0;
		await service.applyTransition(state, true, false);

		expect(repository.recordSession).toHaveBeenCalledTimes(1);
		expect(repository.recordSession).toHaveBeenCalledWith(
			"user-123",
			"guild-123",
			startedAt,
			endedAt,
		);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
		expect(order[0]).toBe("postgres");
		expect(order.slice(1)).toContain("delete:deafen:active-sessions");
	});

	test("keeps active temporary state when postgres finish fails", async () => {
		const repository = createRepository();
		repository.recordSession = mock(async () => {
			throw new Error("db down");
		});
		const temporaryState = createTemporaryState();
		const service = new DeafenTrackerService(repository, temporaryState);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, false, true);
		expect(service.applyTransition(state, true, false)).rejects.toThrow(
			"db down",
		);

		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
		expect(temporaryState.store.has("deafen:active-sessions")).toBe(true);
	});

	test("no boundary crossed persists nothing", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		const service = new DeafenTrackerService(repository, temporaryState);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, true, true);
		await service.applyTransition(state, false, false);

		expect(repository.recordSession).not.toHaveBeenCalled();
		expect(temporaryState.set).not.toHaveBeenCalled();
	});

	test("ending with no active session persists nothing", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		const service = new DeafenTrackerService(repository, temporaryState);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, true, false);

		expect(repository.recordSession).not.toHaveBeenCalled();
	});

	test("concurrent finish attempts record at most once", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let entered = 0;
		repository.recordSession = mock(async () => {
			entered += 1;
			if (entered === 1) {
				await blocked;
			}
			return null;
		});
		const startedAt = new Date("2026-01-01T00:00:00.000Z");
		const endedAt = new Date("2026-01-01T00:05:00.000Z");
		const service = new DeafenTrackerService(
			repository,
			temporaryState,
			fixedClock([startedAt, endedAt, endedAt]),
		);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, false, true);
		const first = service.applyTransition(state, true, false);
		const second = service.applyTransition(state, true, false);
		release();
		await Promise.all([first, second]);

		expect(repository.recordSession).toHaveBeenCalledTimes(1);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
	});

	test("older finish cannot remove a newer restarted session", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		const t1 = new Date("2026-01-01T00:00:00.000Z");
		const t2 = new Date("2026-01-01T00:05:00.000Z");
		const t3 = new Date("2026-01-01T00:10:00.000Z");
		const service = new DeafenTrackerService(
			repository,
			temporaryState,
			fixedClock([t1, t2, t3]),
		);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });
		const sessions = (
			service as unknown as {
				activeSessions: Map<
					string,
					{ userId: string; guildId: string; startedAt: Date }
				>;
			}
		).activeSessions;

		await service.applyTransition(state, false, true);

		// While finishing the original session, a newer session replaces the map entry.
		// Conditional delete must leave the newer session in place.
		repository.recordSession = mock(async () => {
			sessions.set("guild-123:user-123", {
				userId: "user-123",
				guildId: "guild-123",
				startedAt: t3,
			});
			return null;
		});

		await service.applyTransition(state, true, false);

		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
		expect(temporaryState.store.get("deafen:active-sessions")).toEqual([
			{
				userId: "user-123",
				guildId: "guild-123",
				startedAt: t3.toISOString(),
			},
		]);
		expect(repository.recordSession).toHaveBeenCalledWith(
			"user-123",
			"guild-123",
			t1,
			t2,
		);
	});

	test("cross-user concurrent start/finish leaves Redis equal to the live map", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		const gate = makeDeferred<void>();
		const firstSetEntered = makeDeferred<void>();
		let setCalls = 0;
		temporaryState.set = mock(async (key: string, value: unknown) => {
			setCalls += 1;
			if (setCalls === 1) {
				firstSetEntered.resolve();
				await gate.promise;
			}
			temporaryState.store.set(key, value);
		});
		const tStartA = new Date("2026-01-01T00:00:00.000Z");
		const tStartB = new Date("2026-01-01T00:01:00.000Z");
		const tEndA = new Date("2026-01-01T00:05:00.000Z");
		const service = new DeafenTrackerService(
			repository,
			temporaryState,
			fixedClock([tStartA, tStartB, tEndA]),
		);
		const userA = createVoiceState({
			id: "user-a",
			channelId: "voice-1",
			deaf: true,
		});
		const userB = createVoiceState({
			id: "user-b",
			channelId: "voice-1",
			deaf: true,
		});

		// Start A (its snapshot write blocks after entering set).
		const startA = service.applyTransition(userA, false, true);
		await firstSetEntered.promise;
		// Start B and finish A while A's snapshot write is still in flight.
		const startB = service.applyTransition(userB, false, true);
		const finishA = service.applyTransition(userA, true, false);
		gate.resolve();
		await Promise.all([startA, startB, finishA]);

		expect(service.hasActiveSession("guild-123", "user-a")).toBe(false);
		expect(service.hasActiveSession("guild-123", "user-b")).toBe(true);
		expect(temporaryState.store.get("deafen:active-sessions")).toEqual([
			{
				userId: "user-b",
				guildId: "guild-123",
				startedAt: tStartB.toISOString(),
			},
		]);
	});
});

function makeDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("DeafenTrackerService.getActiveSessionSeconds", () => {
	function fixedClock(dates: [Date, ...Date[]]): () => Date {
		let index = 0;
		return () => dates[Math.min(index++, dates.length - 1)] ?? dates[0];
	}

	test("returns null when there is no active session", () => {
		const service = new DeafenTrackerService(
			createRepository(),
			createTemporaryState(),
		);
		expect(service.getActiveSessionSeconds("guild-123", "user-123")).toBe(null);
	});

	test("returns elapsed seconds for an active session", async () => {
		const startedAt = new Date("2026-01-01T00:00:00.000Z");
		const now = new Date("2026-01-01T02:00:00.000Z");
		const service = new DeafenTrackerService(
			createRepository(),
			createTemporaryState(),
			fixedClock([startedAt, now]),
		);
		const state = createVoiceState({ channelId: "voice-1", deaf: true });

		await service.applyTransition(state, false, true);

		expect(service.getActiveSessionSeconds("guild-123", "user-123")).toBe(7200);
	});
});

describe("DeafenTrackerService.initialize and reconcile", () => {
	function fixedClock(dates: [Date, ...Date[]]): () => Date {
		let index = 0;
		return () => dates[Math.min(index++, dates.length - 1)] ?? dates[0];
	}

	test("restores valid sessions and skips malformed entries", async () => {
		const temporaryState = createTemporaryState();
		temporaryState.store.set("deafen:active-sessions", [
			{
				userId: "user-1",
				guildId: "guild-1",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
			{ userId: "bad" },
			{
				userId: "user-2",
				guildId: "guild-2",
				startedAt: "not-a-date",
			},
			null,
			"nope",
		]);
		const service = new DeafenTrackerService(
			createRepository(),
			temporaryState,
		);

		await service.initialize();

		expect(service.hasActiveSession("guild-1", "user-1")).toBe(true);
		expect(service.hasActiveSession("guild-2", "user-2")).toBe(false);
		expect(service.getActiveSessionSeconds("guild-1", "user-1")).not.toBe(null);
	});

	test("reconcile keeps qualifying sessions without resetting startedAt", async () => {
		const startedAt = new Date("2026-01-01T00:00:00.000Z");
		const now = new Date("2026-01-01T01:00:00.000Z");
		const temporaryState = createTemporaryState();
		temporaryState.store.set("deafen:active-sessions", [
			{
				userId: "user-123",
				guildId: "guild-123",
				startedAt: startedAt.toISOString(),
			},
		]);
		const service = new DeafenTrackerService(
			createRepository(),
			temporaryState,
			fixedClock([now]),
		);
		await service.initialize();

		const liveState = createVoiceState({
			channelId: "voice-1",
			deaf: true,
			presenceStatus: "online",
		});
		await service.reconcile(() => liveState, false);

		expect(service.hasActiveSession("guild-123", "user-123")).toBe(true);
		expect(service.getActiveSessionSeconds("guild-123", "user-123")).toBe(3600);
	});

	test("reconcile finishes stale sessions at reconciliation time", async () => {
		const repository = createRepository();
		const startedAt = new Date("2026-01-01T00:00:00.000Z");
		const endedAt = new Date("2026-01-01T00:10:00.000Z");
		const temporaryState = createTemporaryState();
		temporaryState.store.set("deafen:active-sessions", [
			{
				userId: "user-123",
				guildId: "guild-123",
				startedAt: startedAt.toISOString(),
			},
		]);
		const service = new DeafenTrackerService(
			repository,
			temporaryState,
			fixedClock([endedAt]),
		);
		await service.initialize();

		await service.reconcile(() => null, false);

		expect(repository.recordSession).toHaveBeenCalledWith(
			"user-123",
			"guild-123",
			startedAt,
			endedAt,
		);
		expect(service.hasActiveSession("guild-123", "user-123")).toBe(false);
		expect(temporaryState.store.has("deafen:active-sessions")).toBe(false);
	});

	test("reconcile is idempotent within a process", async () => {
		const repository = createRepository();
		const temporaryState = createTemporaryState();
		temporaryState.store.set("deafen:active-sessions", [
			{
				userId: "user-123",
				guildId: "guild-123",
				startedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		const service = new DeafenTrackerService(repository, temporaryState);
		await service.initialize();

		await service.reconcile(() => null, false);
		await service.reconcile(() => null, false);

		expect(repository.recordSession).toHaveBeenCalledTimes(1);
	});
});
