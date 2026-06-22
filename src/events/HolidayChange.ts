import type { ClientEvents } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";
import { BotEvents } from "../models/BotEvents";
import type Holiday from "../models/Holiday";

export default class HolidayChange implements BotEvent {
	once = false;
	event: keyof ClientEvents = BotEvents.HolidayChange;

	async execute(bot: Bot, holiday: Holiday | null): Promise<void> {
		await bot.applyHolidayProfilePicture(holiday);
	}
}
