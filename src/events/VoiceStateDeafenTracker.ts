import { type ClientEvents, Events, type VoiceState } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";
import { isDeafenTrackerActive } from "../services/DeafenTrackerService";

export default class VoiceStateDeafenTracker implements BotEvent {
	once = false;
	event: keyof ClientEvents = Events.VoiceStateUpdate;

	isEnabled(bot: Bot): boolean {
		return isDeafenTrackerActive(bot.config.get("deafentracker"));
	}

	async execute(
		bot: Bot,
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		if (newState.id === bot.user?.id) {
			return;
		}

		const cfg = bot.config.get("deafentracker");
		if (!cfg.users.includes(newState.id)) {
			return;
		}

		const oldCounting = bot.deafenTracker.isCounting(
			oldState,
			cfg.muted_is_deafened,
		);
		const newCounting = bot.deafenTracker.isCounting(
			newState,
			cfg.muted_is_deafened,
		);
		await bot.deafenTracker.applyTransition(newState, oldCounting, newCounting);
	}
}
