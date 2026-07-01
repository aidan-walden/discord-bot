import type { VoiceState } from "discord.js";
import type { DeafenTrackerConfig } from "../config";
import type DeafenSessionRepository from "../repositories/DeafenSessionRepository";

type ActiveDeafenSession = {
	userId: string;
	guildId: string;
	startedAt: Date;
};

/**
 * The deafen tracker only does anything when it is explicitly enabled and at least
 * one user is on the allowlist. Shared by the intent check in `Bot` and the
 * `isEnabled` gate on the deafen event handlers.
 */
export function isDeafenTrackerActive(cfg: DeafenTrackerConfig): boolean {
	return cfg.enabled && cfg.users.length > 0;
}

/**
 * Tracks in-progress deafen stretches in memory and persists each completed stretch.
 *
 * A user is "counting" only while they are in a voice channel, deafened, and not AFK.
 * The `Map` of active sessions is process memory only: on restart any in-flight
 * session is dropped and never persisted.
 */
export default class DeafenTrackerService {
	private readonly activeSessions = new Map<string, ActiveDeafenSession>();

	constructor(
		private readonly repository: DeafenSessionRepository,
		private readonly now: () => Date = () => new Date(),
	) {}

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

		if (!oldCounting && newCounting) {
			this.activeSessions.set(key, {
				userId,
				guildId,
				startedAt: this.now(),
			});
			return;
		}

		if (oldCounting && !newCounting) {
			const session = this.activeSessions.get(key);
			if (!session) {
				return;
			}

			this.activeSessions.delete(key);
			await this.repository.recordSession(
				session.userId,
				session.guildId,
				session.startedAt,
				this.now(),
			);
		}
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
