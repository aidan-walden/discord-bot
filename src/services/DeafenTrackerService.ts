import type { VoiceState } from "discord.js";
import type { DeafenTrackerConfig } from "../config";
import type DeafenSessionRepository from "../repositories/DeafenSessionRepository";
import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";

const ACTIVE_SESSIONS_KEY = "deafen:active-sessions";

type ActiveDeafenSession = {
	userId: string;
	guildId: string;
	startedAt: Date;
};

type PersistedDeafenSession = {
	userId: string;
	guildId: string;
	startedAt: string;
};

type TemporaryStateStore = Pick<
	TemporaryStateRepository,
	"get" | "set" | "delete"
>;

/**
 * The deafen tracker only does anything when it is explicitly enabled and at least
 * one user is on the allowlist. Shared by the intent check in `Bot` and the
 * `isEnabled` gate on the deafen event handlers.
 */
export function isDeafenTrackerActive(cfg: DeafenTrackerConfig): boolean {
	return cfg.enabled && cfg.users.length > 0;
}

function isPersistedSession(value: unknown): value is PersistedDeafenSession {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const entry = value as Record<string, unknown>;
	return (
		typeof entry.userId === "string" &&
		entry.userId.length > 0 &&
		typeof entry.guildId === "string" &&
		entry.guildId.length > 0 &&
		typeof entry.startedAt === "string" &&
		entry.startedAt.length > 0
	);
}

/**
 * Tracks in-progress deafen stretches and persists each completed stretch.
 *
 * A user is "counting" only while they are in a voice channel, deafened, and not AFK.
 * Active sessions are snapshotted to temporary state so they survive bot process
 * restarts while Redis stays up.
 */
export default class DeafenTrackerService {
	private readonly activeSessions = new Map<string, ActiveDeafenSession>();
	// Per session-key chain serializes concurrent updates for the same session.
	private readonly sessionQueues = new Map<string, Promise<void>>();
	// Single write chain so cross-user snapshots cannot finish out of order.
	private persistQueue: Promise<void> = Promise.resolve();
	private reconciled = false;

	constructor(
		private readonly repository: DeafenSessionRepository,
		private readonly temporaryState: TemporaryStateStore,
		private readonly now: () => Date = () => new Date(),
	) {}

	/**
	 * Load active sessions from temporary state. Call before normal use.
	 * Does not qualify against live Discord state - run `reconcile` after ready.
	 */
	async initialize(): Promise<void> {
		const snapshot =
			await this.temporaryState.get<unknown>(ACTIVE_SESSIONS_KEY);
		if (!Array.isArray(snapshot)) {
			return;
		}

		for (const entry of snapshot) {
			if (!isPersistedSession(entry)) {
				continue;
			}
			const startedAt = new Date(entry.startedAt);
			if (Number.isNaN(startedAt.getTime())) {
				continue;
			}
			const key = this.key(entry.guildId, entry.userId);
			await this.runExclusive(key, async () => {
				this.activeSessions.set(key, {
					userId: entry.userId,
					guildId: entry.guildId,
					startedAt,
				});
			});
		}
	}

	/**
	 * After Discord ready/cache hydration, drop restored sessions that no longer
	 * qualify and finish them at reconciliation time. Keeps valid `startedAt`.
	 * Idempotent within a process.
	 */
	async reconcile(
		getVoiceState: (guildId: string, userId: string) => VoiceState | null,
		mutedIsDeafened: boolean,
	): Promise<void> {
		if (this.reconciled) {
			return;
		}
		this.reconciled = true;

		for (const session of [...this.activeSessions.values()]) {
			const key = this.key(session.guildId, session.userId);
			await this.runExclusive(key, async () => {
				const current = this.activeSessions.get(key);
				if (
					!current ||
					current.startedAt.getTime() !== session.startedAt.getTime()
				) {
					return;
				}
				const state = getVoiceState(current.guildId, current.userId);
				const stillCounting =
					state !== null && this.isCounting(state, mutedIsDeafened);
				if (!stillCounting) {
					await this.finishSession(current);
				}
			});
		}
	}

	/**
	 * Whether the given voice state should currently accrue deafened time.
	 */
	isCounting(state: VoiceState, mutedIsDeafened: boolean): boolean {
		if (state.channelId === null) {
			return false;
		}

		const deafened = state.deaf || (mutedIsDeafened && state.mute);
		if (!deafened) {
			return false;
		}

		return !this.isAfk(state);
	}

	hasActiveSession(guildId: string, userId: string): boolean {
		return this.activeSessions.has(this.key(guildId, userId));
	}

	getActiveSessionSeconds(guildId: string, userId: string): number | null {
		const session = this.activeSessions.get(this.key(guildId, userId));
		if (!session) {
			return null;
		}
		return Math.max(
			0,
			Math.floor((this.now().getTime() - session.startedAt.getTime()) / 1000),
		);
	}

	/**
	 * Start, end, or ignore a session based on whether the user crossed the
	 * counting boundary. Ending a session persists it via the repository.
	 */
	async applyTransition(
		state: VoiceState,
		oldCounting: boolean,
		newCounting: boolean,
	): Promise<void> {
		const guildId = state.guild.id;
		const userId = state.id;
		const key = this.key(guildId, userId);

		await this.runExclusive(key, async () => {
			if (!oldCounting && newCounting) {
				this.activeSessions.set(key, {
					userId,
					guildId,
					startedAt: this.now(),
				});
				await this.persistActiveSessions();
				return;
			}

			if (oldCounting && !newCounting) {
				const session = this.activeSessions.get(key);
				if (!session) {
					return;
				}
				await this.finishSession(session);
			}
		});
	}

	/**
	 * Postgres first, then drop active state so failures keep a retryable snapshot.
	 * Must run under the session-key queue. Only removes the map entry when it still
	 * matches this session's start time (an older finish cannot clobber a restart).
	 */
	private async finishSession(session: ActiveDeafenSession): Promise<void> {
		const key = this.key(session.guildId, session.userId);
		await this.repository.recordSession(
			session.userId,
			session.guildId,
			session.startedAt,
			this.now(),
		);
		const current = this.activeSessions.get(key);
		if (
			current &&
			current.startedAt.getTime() === session.startedAt.getTime()
		) {
			this.activeSessions.delete(key);
		}
		await this.persistActiveSessions();
	}

	private runExclusive(key: string, fn: () => Promise<void>): Promise<void> {
		const previous = this.sessionQueues.get(key) ?? Promise.resolve();
		const run = previous.then(fn, fn);
		this.sessionQueues.set(
			key,
			run.then(
				() => undefined,
				() => undefined,
			),
		);
		return run;
	}

	private persistActiveSessions(): Promise<void> {
		const run = this.persistQueue.then(() =>
			this.writeActiveSessionsSnapshot(),
		);
		this.persistQueue = run.catch(() => undefined);
		return run;
	}

	private async writeActiveSessionsSnapshot(): Promise<void> {
		// Read the map only when this write's turn starts so older snapshots
		// for other users cannot overwrite a newer full-map state.
		const entries: PersistedDeafenSession[] = [
			...this.activeSessions.values(),
		].map((session) => ({
			userId: session.userId,
			guildId: session.guildId,
			startedAt: session.startedAt.toISOString(),
		}));
		if (entries.length === 0) {
			await this.temporaryState.delete(ACTIVE_SESSIONS_KEY);
			return;
		}
		await this.temporaryState.set(ACTIVE_SESSIONS_KEY, entries);
	}

	private isAfk(state: VoiceState): boolean {
		const inAfkChannel =
			state.channelId !== null && state.channelId === state.guild.afkChannelId;
		const isIdle = state.member?.presence?.status === "idle";
		return inAfkChannel || isIdle;
	}

	private key(guildId: string, userId: string): string {
		return `${guildId}:${userId}`;
	}
}
