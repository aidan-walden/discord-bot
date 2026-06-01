import type { ClientEvents } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";
import { BotEvents } from "../models/BotEvents";
import type Holiday from "../models/Holiday";

export default class HolidayChange implements BotEvent {
	once = false;
	event: keyof ClientEvents = BotEvents.HolidayChange;

	async execute(bot: Bot, holiday: Holiday | null): Promise<void> {
		const holidayProfilePictures = bot.config.get("holidayProfilePictures");
		if (!holidayProfilePictures) {
			return;
		}

		const baseProfilePicture = bot.config.get("baseProfilePicture");
		if (!baseProfilePicture) {
			console.warn(
				"holidayProfilePictures is configured but baseProfilePicture is not. Skipping profile picture for holiday...",
			);
			return;
		}

		const profilePicture =
			holiday === null
				? baseProfilePicture
				: (holidayProfilePictures[holiday] ?? baseProfilePicture);

		try {
			await bot.setProfilePicture(profilePicture, false);
		} catch (error) {
			console.error("Failed to update holiday profile picture:", error);
		}
	}
}
