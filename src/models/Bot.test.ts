import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Config } from "../config";
import { ProfilePictureValidationError } from "../helpers/profilePicture";
import Bot from "./Bot";
import { BotEvents } from "./BotEvents";
import Holiday from "./Holiday";

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const originalError = console.error;

function buildYaml(profilePictureBlock: string = "") {
	const lines = [
		'BOT_TOKEN: "file-bot-token"',
		'DATABASE_URL: "postgres://file-db"',
		'BOT_OWNER_ID: "file-owner"',
		"ADMIN_USER_IDS: []",
		"lavalink:",
		"  nodes:",
		'    - name: "file-node"',
		'      url: "localhost:2333"',
		'      auth: "file-pass"',
		"      secure: false",
	];

	if (profilePictureBlock.length > 0) {
		lines.push(profilePictureBlock);
	}

	return `${lines.join("\n")}\n`;
}

async function writeTempConfig(yaml: string): Promise<string> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "bot-test-"));
	tempDirs.push(tempDir);

	const filePath = path.join(tempDir, "config.yml");
	await Bun.write(filePath, yaml);
	return filePath;
}

function createBotDouble(
	config: Config,
	setAvatar = mock(async () => undefined),
) {
	return {
		config,
		user: {
			setAvatar,
		},
	} as unknown as Bot;
}

async function readProfilePicture(filePath: string) {
	const parsed = Bun.YAML.parse(await Bun.file(filePath).text()) as Record<
		string,
		unknown
	>;
	return parsed.profilePicture;
}

async function closeBot(bot: Bot): Promise<void> {
	bot.holidays.stop();
	bot.destroy();
	await bot.db.close();
}

afterEach(async () => {
	globalThis.fetch = originalFetch;
	console.warn = originalWarn;
	console.error = originalError;
	await Promise.all(
		tempDirs
			.splice(0)
			.map((tempDir) => rm(tempDir, { recursive: true, force: true })),
	);
});

describe("Bot.setProfilePicture", () => {
	test("returns early when existing profile picture is forced and force is false", async () => {
		const filePath = await writeTempConfig(
			buildYaml(
				[
					"profilePicture:",
					'  path: "./avatars/locked.png"',
					"  forced: true",
				].join("\n"),
			),
		);
		const config = await Config.load(filePath);
		const setAvatar = mock(async () => undefined);
		const bot = createBotDouble(config, setAvatar);
		globalThis.fetch = mock(async () => {
			throw new Error("fetch should not be called");
		}) as unknown as typeof fetch;

		await Bot.prototype.setProfilePicture.call(
			bot,
			"./avatars/requested.png",
			false,
		);

		expect(setAvatar).not.toHaveBeenCalled();
		expect(config.get("profilePicture")).toEqual({
			path: "./avatars/locked.png",
			forced: true,
		});
		expect(await readProfilePicture(filePath)).toEqual({
			path: "./avatars/locked.png",
			forced: true,
		});
	});

	test("sets avatar, writes state, and updates in-memory config", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const setAvatar = mock(async () => undefined);
		const bot = createBotDouble(config, setAvatar);
		globalThis.fetch = mock(async () => {
			return new Response(null, {
				headers: { "content-type": "image/png" },
			});
		}) as unknown as typeof fetch;

		await Bot.prototype.setProfilePicture.call(
			bot,
			"https://example.com/avatar.png",
			true,
		);

		expect(setAvatar).toHaveBeenCalledWith("https://example.com/avatar.png");
		expect(config.get("profilePicture")).toEqual({
			path: "https://example.com/avatar.png",
			forced: true,
		});
		expect(await readProfilePicture(filePath)).toEqual({
			path: "https://example.com/avatar.png",
			forced: true,
		});
	});

	test("rejects remote profile pictures with non-image MIME before Discord update", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const setAvatar = mock(async () => undefined);
		const bot = createBotDouble(config, setAvatar);
		globalThis.fetch = mock(async () => {
			return new Response(null, {
				headers: { "content-type": "text/html" },
			});
		}) as unknown as typeof fetch;

		await expect(
			Bot.prototype.setProfilePicture.call(
				bot,
				"https://example.com/avatar.png",
				true,
			),
		).rejects.toBeInstanceOf(ProfilePictureValidationError);

		expect(setAvatar).not.toHaveBeenCalled();
		expect(config.get("profilePicture")).toBeUndefined();
		expect(await readProfilePicture(filePath)).toBeUndefined();
	});

	test("does not fetch MIME type for local profile picture paths", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const setAvatar = mock(async () => undefined);
		const bot = createBotDouble(config, setAvatar);
		const fetchMock = mock(async () => {
			throw new Error("fetch should not be called");
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await Bot.prototype.setProfilePicture.call(
			bot,
			"./avatars/current.png",
			true,
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(setAvatar).toHaveBeenCalledWith("./avatars/current.png");
	});

	test("does not write state when Discord rejects the avatar update", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const setAvatar = mock(async () => {
			throw new Error("Discord rejected avatar");
		});
		const bot = createBotDouble(config, setAvatar);

		try {
			await Bot.prototype.setProfilePicture.call(
				bot,
				"./avatars/rejected.png",
				false,
			);
			throw new Error("Expected setProfilePicture to throw.");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe("Discord rejected avatar");
		}

		expect(config.get("profilePicture")).toBeUndefined();
		expect(await readProfilePicture(filePath)).toBeUndefined();
	});

	test("throws when bot user is unavailable", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const bot = {
			config,
			user: null,
		} as unknown as Bot;

		try {
			await Bot.prototype.setProfilePicture.call(
				bot,
				"./avatars/current.png",
				true,
			);
			throw new Error("Expected setProfilePicture to throw.");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe("Bot user not found");
		}

		expect(await readProfilePicture(filePath)).toBeUndefined();
	});
});

describe("Bot.releaseProfilePictureOverride", () => {
	test("preserves the current path and clears forced state", async () => {
		const filePath = await writeTempConfig(
			buildYaml(
				[
					"profilePicture:",
					'  path: "https://example.com/avatar.png"',
					"  forced: true",
				].join("\n"),
			),
		);
		const config = await Config.load(filePath);
		const bot = createBotDouble(config);

		await Bot.prototype.releaseProfilePictureOverride.call(bot);

		expect(config.get("profilePicture")).toEqual({
			path: "https://example.com/avatar.png",
			forced: false,
		});
		expect(await readProfilePicture(filePath)).toEqual({
			path: "https://example.com/avatar.png",
			forced: false,
		});
	});
});

describe("Bot.applyHolidayProfilePicture", () => {
	type ConfigValues = {
		baseProfilePicture?: string;
		holidayProfilePictures?: Partial<Record<Holiday, string>>;
	};

	function createHolidayBotDouble(values: ConfigValues): Bot {
		return {
			config: {
				get: mock((key: keyof ConfigValues) => values[key]),
			},
			setProfilePicture: mock(async () => undefined),
		} as unknown as Bot;
	}

	test("sets configured holiday profile picture with force false", async () => {
		const bot = createHolidayBotDouble({
			baseProfilePicture: "./base.png",
			holidayProfilePictures: {
				[Holiday.Xmas]: "./xmas.png",
			},
		});

		await Bot.prototype.applyHolidayProfilePicture.call(bot, Holiday.Xmas);

		expect(bot.setProfilePicture).toHaveBeenCalledWith("./xmas.png", false);
	});

	test("warns and skips invalid configured remote image MIME", async () => {
		const bot = createHolidayBotDouble({
			baseProfilePicture: "./base.png",
			holidayProfilePictures: {
				[Holiday.Xmas]: "https://example.com/xmas.png",
			},
		});
		bot.setProfilePicture = mock(async () => {
			throw new ProfilePictureValidationError("Invalid MIME type.");
		});
		console.warn = mock(() => undefined);
		console.error = mock(() => undefined);

		await Bot.prototype.applyHolidayProfilePicture.call(bot, Holiday.Xmas);

		expect(console.warn).toHaveBeenCalledWith(
			"Skipping configured holiday profile picture because Invalid MIME type.",
		);
		expect(console.error).not.toHaveBeenCalled();
	});

	test("logs unexpected profile picture update failures as errors", async () => {
		const bot = createHolidayBotDouble({
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

		await Bot.prototype.applyHolidayProfilePicture.call(bot, Holiday.Xmas);

		expect(console.error).toHaveBeenCalledWith(
			"Failed to update holiday profile picture:",
			error,
		);
	});
});

describe("Bot admin permissions", () => {
	test("treats BOT_OWNER_ID as admin even when ADMIN_USER_IDS is empty", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const bot = new Bot(config);

		try {
			expect(bot.permissions.isAdminUser("file-owner")).toBe(true);
		} finally {
			await closeBot(bot);
		}
	});
});

describe("Bot holiday events", () => {
	test("forwards HolidayProvider changes to the bot event emitter", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const bot = new Bot(config);
		const events: Array<Holiday | null> = [];

		try {
			bot.on(BotEvents.HolidayChange, (holiday) => {
				events.push(holiday);
			});

			bot.holidays.emit("change", Holiday.Xmas);

			expect(events).toEqual([Holiday.Xmas]);
		} finally {
			await closeBot(bot);
		}
	});

	test("forwards the initial HolidayProvider start event to registered bot listeners", async () => {
		const filePath = await writeTempConfig(buildYaml());
		const config = await Config.load(filePath);
		const bot = new Bot(config);
		const events: Array<Holiday | null> = [];

		try {
			bot.on(BotEvents.HolidayChange, (holiday) => {
				events.push(holiday);
			});

			bot.holidays.start();

			expect(events).toHaveLength(1);
		} finally {
			await closeBot(bot);
		}
	});
});
