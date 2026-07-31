import { type ClientEvents, Events, type VoiceState } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";
import { isDeafenTrackerActive } from "../services/DeafenTrackerService";

/**
 * After Discord ready/cache hydration, qualify restored deafen sessions against
 * live voice+presence state and finish any that no longer count.
 */
export default class DeafenTrackerReady implements BotEvent {
	once = true;
	event: keyof ClientEvents = Events.ClientReady;

	isEnabled(bot: Bot): boolean {
		return isDeafenTrackerActive(bot.config.get("deafentracker"));
	}

	async execute(bot: Bot): Promise<void> {
		const cfg = bot.config.get("deafentracker");
		await bot.deafenTracker.reconcile((guildId, userId) => {
			const guild = bot.guilds.cache.get(guildId);
			if (!guild) {
				return null;
			}
			const voiceState: VoiceState | undefined =
				guild.voiceStates.cache.get(userId);
			return voiceState ?? null;
		}, cfg.muted_is_deafened);
	}
}
