import { afterEach, describe, expect, mock, test } from "bun:test";
import type { HolidayProfilePicturesConfig } from "../config";
import type Bot from "../models/Bot";
import Holiday from "../models/Holiday";
import HolidayChange from "./HolidayChange";

type ConfigValues = {
	baseProfilePicture?: string;
	holidayProfilePictures?: HolidayProfilePicturesConfig;
};

const originalWarn = console.warn;
const originalError = console.error;

function createBotDouble(values: ConfigValues): Bot {
	return {
		config: {
			get: mock((key: keyof ConfigValues) => values[key]),
		},
		setProfilePicture: mock(async () => undefined),
	} as unknown as Bot;
}

afterEach(() => {
	console.warn = originalWarn;
	console.error = originalError;
});

describe("HolidayChange", () => {
	test("returns when both profile picture config blocks are missing", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble({});
		console.warn = mock(() => undefined);

		await event.execute(bot, Holiday.Xmas);

		expect(bot.setProfilePicture).not.toHaveBeenCalled();
		expect(console.warn).not.toHaveBeenCalled();
	});

	test("returns without warning when holiday profile pictures are missing", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble({
			baseProfilePicture: "./base.png",
		});
		console.warn = mock(() => undefined);

		await event.execute(bot, Holiday.Xmas);

		expect(bot.setProfilePicture).not.toHaveBeenCalled();
		expect(console.warn).not.toHaveBeenCalled();
	});

	test("warns and returns when base profile picture is missing", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble({
			holidayProfilePictures: {
				[Holiday.Xmas]: "./xmas.png",
			},
		});
		console.warn = mock(() => undefined);

		await event.execute(bot, Holiday.Xmas);

		expect(bot.setProfilePicture).not.toHaveBeenCalled();
		expect(console.warn).toHaveBeenCalledTimes(1);
	});

	test("sets configured holiday profile picture with force false", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble({
			baseProfilePicture: "./base.png",
			holidayProfilePictures: {
				[Holiday.Xmas]: "./xmas.png",
			},
		});

		await event.execute(bot, Holiday.Xmas);

		expect(bot.setProfilePicture).toHaveBeenCalledWith("./xmas.png", false);
	});

	test("sets base profile picture with force false when no holiday is active", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble({
			baseProfilePicture: "./base.png",
			holidayProfilePictures: {
				[Holiday.Xmas]: "./xmas.png",
			},
		});

		await event.execute(bot, null);

		expect(bot.setProfilePicture).toHaveBeenCalledWith("./base.png", false);
	});

	test("falls back to base profile picture when active holiday has no configured picture", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble({
			baseProfilePicture: "./base.png",
			holidayProfilePictures: {
				[Holiday.Xmas]: "./xmas.png",
			},
		});

		await event.execute(bot, Holiday.Halloween);

		expect(bot.setProfilePicture).toHaveBeenCalledWith("./base.png", false);
	});

	test("logs setProfilePicture failures", async () => {
		const event = new HolidayChange();
		const bot = createBotDouble({
			baseProfilePicture: "./base.png",
			holidayProfilePictures: {
				[Holiday.Xmas]: "./xmas.png",
			},
		});
		const error = new Error("Discord rejected avatar");
		bot.setProfilePicture = mock(async () => {
			throw error;
		});
		console.error = mock(() => undefined);

		await event.execute(bot, Holiday.Xmas);

		expect(console.error).toHaveBeenCalledWith(
			"Failed to update holiday profile picture:",
			error,
		);
	});
});
