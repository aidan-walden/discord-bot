import { type ClientEvents, Events, type Presence } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";
import { isDeafenTrackerActive } from "../services/DeafenTrackerService";

export default class PresenceUpdate implements BotEvent {
	once = false;
	event: keyof ClientEvents = Events.PresenceUpdate;

	isEnabled(bot: Bot): boolean {
		return isDeafenTrackerActive(bot.config.get("deafentracker"));
	}

	async execute(
		bot: Bot,
		_oldPresence: Presence | null,
		newPresence: Presence,
	): Promise<void> {
		const member = newPresence.member;
		if (!member) {
			return;
		}

		const cfg = bot.config.get("deafentracker");
		if (!cfg.users.includes(member.id)) {
			return;
		}

		const voiceState = member.voice;
		if (voiceState.channelId === null) {
			return;
		}

		// The presence change itself is the trigger: whether we were counting is
		// tracked by the in-memory session, and the new counting state reads the
		// now-updated presence status.
		const oldCounting = bot.deafenTracker.hasActiveSession(
			member.guild.id,
			member.id,
		);
		const newCounting = bot.deafenTracker.isCounting(
			voiceState,
			cfg.muted_is_deafened,
		);
		await bot.deafenTracker.applyTransition(
			voiceState,
			oldCounting,
			newCounting,
		);
	}
}
