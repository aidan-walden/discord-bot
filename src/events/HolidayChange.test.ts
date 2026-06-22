import { describe, expect, mock, test } from "bun:test";
import type Bot from "../models/Bot";
import Holiday from "../models/Holiday";
import HolidayChange from "./HolidayChange";

function createBotDouble(): Bot {
	return {
		applyHolidayProfilePicture: mock(async () => undefined),
	} as unknown as Bot;
}

describe("HolidayChange", () => {
	test("applies the holiday profile picture through the bot", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble();

		await event.execute(bot, Holiday.Xmas);

		expect(bot.applyHolidayProfilePicture).toHaveBeenCalledWith(Holiday.Xmas);
	});
});
