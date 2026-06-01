import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Config } from "../config";
import Bot from "./Bot";

const tempDirs: string[] = [];

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

afterEach(async () => {
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
