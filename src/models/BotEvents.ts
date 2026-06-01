import type Holiday from "./Holiday";

export const BotEvents = {
	HolidayChange: "holidayChange",
} as const;

declare module "discord.js" {
	interface ClientEvents {
		[BotEvents.HolidayChange]: [holiday: Holiday | null];
	}
}
