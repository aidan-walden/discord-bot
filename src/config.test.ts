import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Config, type ConfigClock } from "./config";
import Holiday from "./models/Holiday";

const tempDirs: string[] = [];
const CONFIG_ENV_KEYS = [
	"BOT_TOKEN",
	"DATABASE_URL",
	"BOT_OWNER_ID",
	"OPENAI_API_TOKEN",
	"OPENAI_MODEL",
] as const;

const baseYaml = [
	'BOT_TOKEN: "file-bot-token"',
	'DATABASE_URL: "postgres://file-db"',
	'BOT_OWNER_ID: "file-owner"',
	'OPENAI_API_TOKEN: "file-openai-token"',
	'OPENAI_MODEL: "file-model"',
	"ADMIN_USER_IDS:",
	'  - "admin-a"',
	'  - "admin-b"',
	"lavalink:",
	"  nodes:",
	'    - name: "file-node"',
	'      url: "localhost:2333"',
	'      auth: "file-pass"',
	"      secure: false",
].join("\n");

type EnvKey = (typeof CONFIG_ENV_KEYS)[number];
type ConfigInstance = Awaited<ReturnType<typeof Config.load>>;

type FakeTimer = {
	id: number;
	delay: number;
	runAt: number;
	callback: () => void;
	cleared: boolean;
	ran: boolean;
};

class FakeClock implements ConfigClock {
	private nextId = 1;
	private nowMs = 0;
	private readonly timers: FakeTimer[] = [];

	public setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
		const timer: FakeTimer = {
			id: this.nextId++,
			delay,
			runAt: this.nowMs + Math.max(delay, 0),
			callback,
			cleared: false,
			ran: false,
		};
		this.timers.push(timer);
		return timer as unknown as NodeJS.Timeout;
	}

	public clearTimeout(timeout: NodeJS.Timeout): void {
		const timer = timeout as unknown as FakeTimer;
		timer.cleared = true;
	}

	public getPendingTimers(): FakeTimer[] {
		return this.timers
			.filter((timer) => !timer.cleared && !timer.ran)
			.sort((left, right) => left.runAt - right.runAt);
	}

	public advanceBy(ms: number): void {
		const targetMs = this.nowMs + ms;

		while (true) {
			const nextTimer = this.getPendingTimers().find(
				(timer) => timer.runAt <= targetMs,
			);
			if (!nextTimer) {
				break;
			}

			nextTimer.ran = true;
			this.nowMs = nextTimer.runAt;
			nextTimer.callback();
		}

		this.nowMs = targetMs;
	}
}

type YamlOptions = {
	BOT_TOKEN?: string;
	DATABASE_URL?: string;
	BOT_OWNER_ID?: string;
	OPENAI_API_TOKEN?: string;
	OPENAI_MODEL?: string;
	adminUserIdsBlock?: string;
	profilePictureBlock?: string;
	holidayProfilePicturesBlock?: string;
	lavalinkBlock?: string;
	omitKeys?: EnvKey[];
};

function buildYaml(options: YamlOptions = {}) {
	const {
		BOT_TOKEN = "file-bot-token",
		DATABASE_URL = "postgres://file-db",
		BOT_OWNER_ID = "file-owner",
		OPENAI_API_TOKEN = "file-openai-token",
		OPENAI_MODEL = "file-model",
		adminUserIdsBlock,
		profilePictureBlock,
		holidayProfilePicturesBlock,
		lavalinkBlock,
		omitKeys = [],
	} = options;
	const lines: string[] = [];

	if (!omitKeys.includes("BOT_TOKEN")) {
		lines.push(`BOT_TOKEN: ${JSON.stringify(BOT_TOKEN)}`);
	}

	if (!omitKeys.includes("DATABASE_URL")) {
		lines.push(`DATABASE_URL: ${JSON.stringify(DATABASE_URL)}`);
	}

	if (!omitKeys.includes("BOT_OWNER_ID")) {
		lines.push(`BOT_OWNER_ID: ${JSON.stringify(BOT_OWNER_ID)}`);
	}

	if (!omitKeys.includes("OPENAI_API_TOKEN")) {
		lines.push(`OPENAI_API_TOKEN: ${JSON.stringify(OPENAI_API_TOKEN)}`);
	}

	if (!omitKeys.includes("OPENAI_MODEL")) {
		lines.push(`OPENAI_MODEL: ${JSON.stringify(OPENAI_MODEL)}`);
	}

	if (adminUserIdsBlock === undefined) {
		lines.push("ADMIN_USER_IDS:", '  - "admin-a"', '  - "admin-b"');
	} else if (adminUserIdsBlock.length > 0) {
		lines.push(adminUserIdsBlock);
	}

	if (profilePictureBlock !== undefined && profilePictureBlock.length > 0) {
		lines.push(profilePictureBlock);
	}

	if (
		holidayProfilePicturesBlock !== undefined &&
		holidayProfilePicturesBlock.length > 0
	) {
		lines.push(holidayProfilePicturesBlock);
	}

	if (lavalinkBlock === undefined) {
		lines.push(
			"lavalink:",
			"  nodes:",
			'    - name: "file-node"',
			'      url: "localhost:2333"',
			'      auth: "file-pass"',
			"      secure: false",
		);
	} else if (lavalinkBlock.length > 0) {
		lines.push(lavalinkBlock);
	}

	return `${lines.join("\n")}\n`;
}

async function writeTempConfig(yaml: string): Promise<string> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "config-test-"));
	tempDirs.push(tempDir);

	const filePath = path.join(tempDir, "config.yml");
	await Bun.write(filePath, yaml);
	return filePath;
}

async function writeTempFile(
	configPath: string,
	relativePath: string,
	contents = "image",
): Promise<void> {
	await Bun.write(path.join(path.dirname(configPath), relativePath), contents);
}

async function readTempConfig(
	filePath: string,
): Promise<Record<string, unknown>> {
	const parsed = Bun.YAML.parse(await Bun.file(filePath).text());
	expect(Array.isArray(parsed)).toBe(false);
	expect(typeof parsed).toBe("object");
	expect(parsed).not.toBeNull();
	return parsed as Record<string, unknown>;
}

async function withEnv(
	overrides: Partial<Record<EnvKey, string | undefined>>,
	run: () => Promise<void>,
) {
	const snapshot = { ...process.env };

	for (const key of CONFIG_ENV_KEYS) {
		delete process.env[key];
	}

	for (const [key, value] of Object.entries(overrides)) {
		if (value !== undefined) {
			process.env[key] = value;
		}
	}

	try {
		await run();
	} finally {
		for (const key of Object.keys(process.env)) {
			delete process.env[key];
		}

		Object.assign(process.env, snapshot);
	}
}

async function expectLoadConfigError(
	yaml: string,
	expectedMessage: string,
	env: Partial<Record<EnvKey, string | undefined>> = {},
) {
	await withEnv(env, async () => {
		const filePath = await writeTempConfig(yaml);

		try {
			await Config.load(filePath);
			throw new Error("Expected Config.load to throw.");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe(expectedMessage);
		}
	});
}

afterEach(async () => {
	await Promise.all(
		tempDirs
			.splice(0)
			.map((tempDir) => rm(tempDir, { recursive: true, force: true })),
	);
});

describe("Config", () => {
	test("buildYaml() returns same string as base yaml fixture", () => {
		expect(buildYaml()).toBe(`${baseYaml}\n`);
	});

	describe("env over file precedence", () => {
		const precedenceCases = [
			{
				name: "BOT_TOKEN",
				env: { BOT_TOKEN: "env-bot-token" },
				assert: (config: ConfigInstance) => {
					expect(config.get("BOT_TOKEN")).toBe("env-bot-token");
				},
			},
			{
				name: "DATABASE_URL",
				env: { DATABASE_URL: "postgres://env-db" },
				assert: (config: ConfigInstance) => {
					expect(config.get("DATABASE_URL")).toBe("postgres://env-db");
				},
			},
			{
				name: "BOT_OWNER_ID",
				env: { BOT_OWNER_ID: "env-owner" },
				assert: (config: ConfigInstance) => {
					expect(config.get("BOT_OWNER_ID")).toBe("env-owner");
				},
			},
			{
				name: "OPENAI_MODEL",
				env: { OPENAI_MODEL: "env-model" },
				assert: (config: ConfigInstance) => {
					expect(config.get("OPENAI_MODEL")).toBe("env-model");
				},
			},
			{
				name: "OPENAI_API_TOKEN",
				env: { OPENAI_API_TOKEN: "env-openai-token" },
				assert: (config: ConfigInstance) => {
					expect(config.get("OPENAI_API_TOKEN")).toBe("env-openai-token");
				},
			},
		] as const;

		for (const testCase of precedenceCases) {
			test(`${testCase.name} uses env value over file`, async () => {
				await withEnv(testCase.env, async () => {
					const filePath = await writeTempConfig(buildYaml());
					const config = await Config.load(filePath);

					testCase.assert(config);
				});
			});
		}

		const blankRequiredOverrideCases = [
			{
				name: "BOT_TOKEN",
				env: { BOT_TOKEN: "" },
				expectedMessage:
					"BOT_TOKEN is not set. Define BOT_TOKEN in environment or set BOT_TOKEN in config.yml.",
			},
			{
				name: "DATABASE_URL",
				env: { DATABASE_URL: "" },
				expectedMessage:
					"DATABASE_URL is not set. Define DATABASE_URL in environment or set DATABASE_URL in config.yml.",
			},
			{
				name: "BOT_OWNER_ID",
				env: { BOT_OWNER_ID: "" },
				expectedMessage:
					"BOT_OWNER_ID is not set. Define BOT_OWNER_ID in environment or set BOT_OWNER_ID in config.yml.",
			},
		] as const;

		for (const testCase of blankRequiredOverrideCases) {
			test(`${testCase.name} uses blank env value over file and fails validation`, async () => {
				await expectLoadConfigError(
					buildYaml(),
					testCase.expectedMessage,
					testCase.env,
				);
			});
		}

		const blankOptionalOverrideCases = [
			{
				name: "OPENAI_MODEL",
				env: { OPENAI_MODEL: "" },
				assert: (config: ConfigInstance) => {
					expect(config.get("OPENAI_MODEL")).toBe("");
				},
			},
			{
				name: "OPENAI_API_TOKEN",
				env: { OPENAI_API_TOKEN: "" },
				assert: (config: ConfigInstance) => {
					expect(config.get("OPENAI_API_TOKEN")).toBe("");
				},
			},
		] as const;

		for (const testCase of blankOptionalOverrideCases) {
			test(`${testCase.name} uses blank env value over file`, async () => {
				await withEnv(testCase.env, async () => {
					const filePath = await writeTempConfig(buildYaml());
					const config = await Config.load(filePath);

					testCase.assert(config);
				});
			});
		}
	});

	describe("missing required keys", () => {
		const requiredKeyCases = [
			{
				name: "blank BOT_TOKEN",
				yaml: buildYaml({ BOT_TOKEN: "" }),
				expectedMessage:
					"BOT_TOKEN is not set. Define BOT_TOKEN in environment or set BOT_TOKEN in config.yml.",
			},
			{
				name: "missing BOT_TOKEN",
				yaml: buildYaml({ omitKeys: ["BOT_TOKEN"] }),
				expectedMessage:
					"BOT_TOKEN is not set. Define BOT_TOKEN in environment or set BOT_TOKEN in config.yml.",
			},
			{
				name: "blank DATABASE_URL",
				yaml: buildYaml({ DATABASE_URL: "" }),
				expectedMessage:
					"DATABASE_URL is not set. Define DATABASE_URL in environment or set DATABASE_URL in config.yml.",
			},
			{
				name: "missing DATABASE_URL",
				yaml: buildYaml({ omitKeys: ["DATABASE_URL"] }),
				expectedMessage:
					"DATABASE_URL is not set. Define DATABASE_URL in environment or set DATABASE_URL in config.yml.",
			},
			{
				name: "blank BOT_OWNER_ID",
				yaml: buildYaml({ BOT_OWNER_ID: "" }),
				expectedMessage:
					"BOT_OWNER_ID is not set. Define BOT_OWNER_ID in environment or set BOT_OWNER_ID in config.yml.",
			},
			{
				name: "missing BOT_OWNER_ID",
				yaml: buildYaml({ omitKeys: ["BOT_OWNER_ID"] }),
				expectedMessage:
					"BOT_OWNER_ID is not set. Define BOT_OWNER_ID in environment or set BOT_OWNER_ID in config.yml.",
			},
		] as const;

		for (const testCase of requiredKeyCases) {
			test(`${testCase.name} fails startup validation`, async () => {
				await expectLoadConfigError(testCase.yaml, testCase.expectedMessage);
			});
		}
	});

	describe("invalid YAML root", () => {
		const invalidRootCases = [
			{
				name: "array root",
				yaml: "[]\n",
			},
			{
				name: "scalar root",
				yaml: "foo\n",
			},
		] as const;

		for (const testCase of invalidRootCases) {
			test(`${testCase.name} is rejected`, async () => {
				const filePath = await writeTempConfig(testCase.yaml);

				await withEnv({}, async () => {
					try {
						await Config.load(filePath);
						throw new Error("Expected Config.load to throw.");
					} catch (error) {
						expect(error).toBeInstanceOf(Error);
						expect((error as Error).message).toBe(
							`Invalid config format in ${filePath}: expected an object at root.`,
						);
					}
				});
			});
		}
	});

	test("ADMIN_USER_IDS removes duplicates and keeps first-seen order", async () => {
		await withEnv({}, async () => {
			const filePath = await writeTempConfig(
				buildYaml({
					adminUserIdsBlock: [
						"ADMIN_USER_IDS:",
						'  - "admin-a"',
						'  - "admin-a"',
						'  - "admin-b"',
						'  - "admin-a"',
					].join("\n"),
				}),
			);
			const config = await Config.load(filePath);

			expect(config.get("ADMIN_USER_IDS")).toEqual(["admin-a", "admin-b"]);
		});
	});

	test("ADMIN_USER_IDS defaults to empty array when omitted", async () => {
		await withEnv({}, async () => {
			const filePath = await writeTempConfig(
				buildYaml({ adminUserIdsBlock: "" }),
			);
			const config = await Config.load(filePath);

			expect(config.get("ADMIN_USER_IDS")).toEqual([]);
		});
	});

	test("ADMIN_USER_IDS rejects non-array values", async () => {
		await expectLoadConfigError(
			buildYaml({ adminUserIdsBlock: 'ADMIN_USER_IDS: "not-an-array"' }),
			"Invalid config value for ADMIN_USER_IDS: expected array of strings.",
		);
	});

	test("get() returns cloned object and array values", async () => {
		await withEnv({}, async () => {
			const filePath = await writeTempConfig(
				buildYaml({
					profilePictureBlock: [
						"profilePicture:",
						'  path: "./avatars/current.png"',
						"  forced: true",
					].join("\n"),
					holidayProfilePicturesBlock: [
						"holidayProfilePictures:",
						'  XMAS: "./avatars/xmas.png"',
					].join("\n"),
				}),
			);
			await mkdir(path.join(path.dirname(filePath), "avatars"));
			await writeTempFile(filePath, "avatars/xmas.png");
			const config = await Config.load(filePath);

			const adminUserIds = config.get("ADMIN_USER_IDS");
			adminUserIds.push("mutated-admin");

			const lavalink = config.get("lavalink");
			lavalink.nodes[0] = {
				name: "mutated-node",
				url: "localhost:2334",
				auth: "mutated-pass",
				secure: true,
			};

			const profilePicture = config.get("profilePicture");
			if (!profilePicture) {
				throw new Error("Expected profilePicture to be set.");
			}
			profilePicture.path = "./avatars/mutated.png";

			const holidayProfilePictures = config.get("holidayProfilePictures");
			if (!holidayProfilePictures) {
				throw new Error("Expected holidayProfilePictures to be set.");
			}
			holidayProfilePictures[Holiday.Xmas] = "./avatars/mutated.png";

			expect(config.get("ADMIN_USER_IDS")).toEqual(["admin-a", "admin-b"]);
			expect(config.get("lavalink").nodes[0]?.name).toBe("file-node");
			expect(config.get("profilePicture")).toEqual({
				path: "./avatars/current.png",
				forced: true,
			});
			expect(config.get("holidayProfilePictures")).toEqual({
				[Holiday.Xmas]: "./avatars/xmas.png",
			});
		});
	});

	describe("set() persistence", () => {
		test("updates get() immediately", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath, clock);

				config.set("ADMIN_USER_IDS", ["new-admin"]);

				expect(config.get("ADMIN_USER_IDS")).toEqual(["new-admin"]);
			});
		});

		test("does not write to disk before five seconds", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath, clock);

				config.set("ADMIN_USER_IDS", ["new-admin"]);
				clock.advanceBy(4_999);

				const persisted = await readTempConfig(filePath);
				expect(persisted.ADMIN_USER_IDS).toEqual(["admin-a", "admin-b"]);
			});
		});

		test("writes to disk after five seconds", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath, clock);

				config.set("ADMIN_USER_IDS", ["new-admin"]);
				clock.advanceBy(5_000);
				await config.flush();

				const persisted = await readTempConfig(filePath);
				expect(persisted.ADMIN_USER_IDS).toEqual(["new-admin"]);
			});
		});

		test("resets the write timeout when set() is called again", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath, clock);

				config.set("ADMIN_USER_IDS", ["first-admin"]);
				clock.advanceBy(4_999);
				config.set("ADMIN_USER_IDS", ["second-admin"]);
				clock.advanceBy(4_999);

				let persisted = await readTempConfig(filePath);
				expect(persisted.ADMIN_USER_IDS).toEqual(["admin-a", "admin-b"]);

				clock.advanceBy(1);
				await config.flush();

				persisted = await readTempConfig(filePath);
				expect(persisted.ADMIN_USER_IDS).toEqual(["second-admin"]);
			});
		});

		test("writes file-backed state without env override values", async () => {
			await withEnv(
				{
					BOT_TOKEN: "env-bot-token",
					OPENAI_API_TOKEN: "env-openai-token",
				},
				async () => {
					const clock = new FakeClock();
					const filePath = await writeTempConfig(buildYaml());
					const config = await Config.load(filePath, clock);

					expect(config.get("BOT_TOKEN")).toBe("env-bot-token");
					expect(config.get("OPENAI_API_TOKEN")).toBe("env-openai-token");

					config.set("ADMIN_USER_IDS", ["new-admin"]);
					clock.advanceBy(5_000);
					await config.flush();

					const persisted = await readTempConfig(filePath);
					expect(persisted.BOT_TOKEN).toBe("file-bot-token");
					expect(persisted.OPENAI_API_TOKEN).toBe("file-openai-token");
					expect(persisted.ADMIN_USER_IDS).toEqual(["new-admin"]);
				},
			);
		});

		test("invalid set() values do not mutate state or schedule writes", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath, clock);

				expect(() => config.set("BOT_TOKEN", "")).toThrow(
					"BOT_TOKEN is not set. Define BOT_TOKEN in environment or set BOT_TOKEN in config.yml.",
				);

				expect(config.get("BOT_TOKEN")).toBe("file-bot-token");
				expect(clock.getPendingTimers()).toEqual([]);

				const persisted = await readTempConfig(filePath);
				expect(persisted.BOT_TOKEN).toBe("file-bot-token");
			});
		});

		test("undefined set() values warn without mutating state or scheduling writes", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath, clock);
				const consoleWarn = spyOn(console, "warn").mockImplementation(
					() => undefined,
				);

				try {
					config.set("OPENAI_MODEL", undefined as never);

					expect(consoleWarn).toHaveBeenCalledWith(
						"undefined passed to Config.set for key OPENAI_MODEL, ignoring...",
					);
					expect(config.get("OPENAI_MODEL")).toBe("file-model");
					expect(clock.getPendingTimers()).toEqual([]);

					const persisted = await readTempConfig(filePath);
					expect(persisted.OPENAI_MODEL).toBe("file-model");
				} finally {
					consoleWarn.mockRestore();
				}
			});
		});

		test("optional keys set to null are removed from persisted YAML", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath, clock);

				config.set("OPENAI_MODEL", null);
				clock.advanceBy(5_000);
				await config.flush();

				expect(config.get("OPENAI_MODEL")).toBeUndefined();
				const persisted = await readTempConfig(filePath);
				expect("OPENAI_MODEL" in persisted).toBe(false);
			});
		});
	});

	describe("profilePicture validation", () => {
		test("loads valid profile picture state", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(
					buildYaml({
						profilePictureBlock: [
							"profilePicture:",
							'  path: "./avatars/current.png"',
							"  forced: true",
						].join("\n"),
					}),
				);

				const config = await Config.load(filePath);

				expect(config.get("profilePicture")).toEqual({
					path: "./avatars/current.png",
					forced: true,
				});
			});
		});

		test("defaults to undefined when omitted", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath);

				expect(config.get("profilePicture")).toBeUndefined();
			});
		});

		test("rejects invalid path", async () => {
			await expectLoadConfigError(
				buildYaml({
					profilePictureBlock: [
						"profilePicture:",
						'  path: ""',
						"  forced: true",
					].join("\n"),
				}),
				"Invalid config value for profilePicture.path: expected non-empty string.",
			);
		});

		test("rejects invalid forced flag", async () => {
			await expectLoadConfigError(
				buildYaml({
					profilePictureBlock: [
						"profilePicture:",
						'  path: "./avatars/current.png"',
						'  forced: "true"',
					].join("\n"),
				}),
				"Invalid config value for profilePicture.forced: expected boolean.",
			);
		});

		test("writes profile picture state without changing existing config semantically", async () => {
			await withEnv({}, async () => {
				const clock = new FakeClock();
				const filePath = await writeTempConfig(buildYaml());
				const before = await readTempConfig(filePath);
				const config = await Config.load(filePath, clock);

				config.set("profilePicture", {
					path: "https://example.com/avatar.png",
					forced: false,
				});
				await config.flush();

				const after = await readTempConfig(filePath);
				const { profilePicture: _beforeProfilePicture, ...beforeRest } = before;
				const { profilePicture, ...afterRest } = after;

				expect(afterRest).toEqual(beforeRest);
				expect(profilePicture).toEqual({
					path: "https://example.com/avatar.png",
					forced: false,
				});
			});
		});
	});

	describe("holidayProfilePictures validation", () => {
		test("defaults to undefined when omitted", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(buildYaml());
				const config = await Config.load(filePath);

				expect(config.get("holidayProfilePictures")).toBeUndefined();
			});
		});

		test("loads valid local file paths relative to the config file", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(
					buildYaml({
						holidayProfilePicturesBlock: [
							"holidayProfilePictures:",
							'  XMAS: "./xmas.png"',
						].join("\n"),
					}),
				);
				await writeTempFile(filePath, "xmas.png");

				const config = await Config.load(filePath);

				expect(config.get("holidayProfilePictures")).toEqual({
					[Holiday.Xmas]: "./xmas.png",
				});
			});
		});

		test("loads valid direct image URLs", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(
					buildYaml({
						holidayProfilePicturesBlock: [
							"holidayProfilePictures:",
							'  HALLOWEEN: "https://example.com/avatar.webp"',
						].join("\n"),
					}),
				);

				const config = await Config.load(filePath);

				expect(config.get("holidayProfilePictures")).toEqual({
					[Holiday.Halloween]: "https://example.com/avatar.webp",
				});
			});
		});

		test("loads multiple valid holidays with omitted holidays unset", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(
					buildYaml({
						holidayProfilePicturesBlock: [
							"holidayProfilePictures:",
							'  XMAS: "./xmas.png"',
							'  THANKSGIVING: "https://example.com/thanksgiving.jpg"',
						].join("\n"),
					}),
				);
				await writeTempFile(filePath, "xmas.png");

				const config = await Config.load(filePath);

				expect(config.get("holidayProfilePictures")).toEqual({
					[Holiday.Xmas]: "./xmas.png",
					[Holiday.Thanksgiving]: "https://example.com/thanksgiving.jpg",
				});
				expect(
					config.get("holidayProfilePictures")?.[Holiday.Halloween],
				).toBeUndefined();
			});
		});

		test("rejects unknown holiday keys", async () => {
			await expectLoadConfigError(
				buildYaml({
					holidayProfilePicturesBlock: [
						"holidayProfilePictures:",
						'  VALENTINES_DAY: "https://example.com/avatar.png"',
					].join("\n"),
				}),
				"Invalid config value for holidayProfilePictures.VALENTINES_DAY: expected a holiday defined in Holiday.ts.",
			);
		});

		test("rejects invalid block shapes", async () => {
			await expectLoadConfigError(
				buildYaml({
					holidayProfilePicturesBlock: "holidayProfilePictures: []",
				}),
				"Invalid config value for holidayProfilePictures: expected object.",
			);
		});

		const invalidValueCases = [
			{
				name: "null member",
				value: "null",
			},
			{
				name: "empty member",
				value: '""',
			},
			{
				name: "non-string member",
				value: "123",
			},
		] as const;

		for (const testCase of invalidValueCases) {
			test(`rejects ${testCase.name}`, async () => {
				await expectLoadConfigError(
					buildYaml({
						holidayProfilePicturesBlock: [
							"holidayProfilePictures:",
							`  XMAS: ${testCase.value}`,
						].join("\n"),
					}),
					"Invalid config value for holidayProfilePictures.XMAS: expected non-empty string.",
				);
			});
		}

		test("rejects missing local paths", async () => {
			await expectLoadConfigError(
				buildYaml({
					holidayProfilePicturesBlock: [
						"holidayProfilePictures:",
						'  XMAS: "./missing.png"',
					].join("\n"),
				}),
				"Invalid config value for holidayProfilePictures.XMAS: expected an existing local file path or direct HTTP(S) image URL.",
			);
		});

		test("rejects directory paths", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(
					buildYaml({
						holidayProfilePicturesBlock: [
							"holidayProfilePictures:",
							'  XMAS: "./avatars"',
						].join("\n"),
					}),
				);
				await mkdir(path.join(path.dirname(filePath), "avatars"));

				try {
					await Config.load(filePath);
					throw new Error("Expected Config.load to throw.");
				} catch (error) {
					expect(error).toBeInstanceOf(Error);
					expect((error as Error).message).toBe(
						"Invalid config value for holidayProfilePictures.XMAS: expected an existing local file path or direct HTTP(S) image URL.",
					);
				}
			});
		});

		const invalidUrlCases = [
			{
				name: "non-image URL",
				value: "https://example.com/avatar.txt",
			},
			{
				name: "non-http URL",
				value: "ftp://example.com/avatar.png",
			},
		] as const;

		for (const testCase of invalidUrlCases) {
			test(`rejects ${testCase.name}`, async () => {
				await expectLoadConfigError(
					buildYaml({
						holidayProfilePicturesBlock: [
							"holidayProfilePictures:",
							`  XMAS: ${JSON.stringify(testCase.value)}`,
						].join("\n"),
					}),
					"Invalid config value for holidayProfilePictures.XMAS: expected an existing local file path or direct HTTP(S) image URL.",
				);
			});
		}

		test("writes holiday profile pictures without changing existing config semantically", async () => {
			await withEnv({}, async () => {
				const filePath = await writeTempConfig(buildYaml());
				const before = await readTempConfig(filePath);
				await writeTempFile(filePath, "xmas.png");
				const config = await Config.load(filePath);

				config.set("holidayProfilePictures", {
					[Holiday.Xmas]: "./xmas.png",
					[Holiday.AprilFools]: "https://example.com/april-fools.avif",
				});
				await config.flush();

				const after = await readTempConfig(filePath);
				const {
					holidayProfilePictures: _beforeHolidayProfilePictures,
					...beforeRest
				} = before;
				const { holidayProfilePictures, ...afterRest } = after;

				expect(afterRest).toEqual(beforeRest);
				expect(holidayProfilePictures).toEqual({
					[Holiday.Xmas]: "./xmas.png",
					[Holiday.AprilFools]: "https://example.com/april-fools.avif",
				});
			});
		});
	});

	test("reports unreadable config files", async () => {
		await withEnv({}, async () => {
			const tempDir = await mkdtemp(path.join(os.tmpdir(), "config-test-"));
			tempDirs.push(tempDir);
			const filePath = path.join(tempDir, "missing-config.yml");

			try {
				await Config.load(filePath);
				throw new Error("Expected Config.load to throw.");
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).message).toContain(
					`Failed to read config file at ${filePath}:`,
				);
			}
		});
	});

	describe("lavalink node validation", () => {
		const lavalinkCases = [
			{
				name: "missing lavalink block",
				yaml: buildYaml({ lavalinkBlock: "" }),
				expectedMessage:
					"Invalid config value for lavalink.nodes: expected non-empty array.",
			},
			{
				name: "missing nodes",
				yaml: buildYaml({ lavalinkBlock: "lavalink: {}" }),
				expectedMessage:
					"Invalid config value for lavalink.nodes: expected non-empty array.",
			},
			{
				name: "empty nodes",
				yaml: buildYaml({
					lavalinkBlock: ["lavalink:", "  nodes: []"].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes: expected non-empty array.",
			},
			{
				name: "non-object node",
				yaml: buildYaml({
					lavalinkBlock: ["lavalink:", "  nodes:", '    - "bad-node"'].join(
						"\n",
					),
				}),
				expectedMessage: "Invalid lavalink.nodes[0]: expected object.",
			},
			{
				name: "missing node name",
				yaml: buildYaml({
					lavalinkBlock: [
						"lavalink:",
						"  nodes:",
						'    - url: "localhost:2333"',
						'      auth: "file-pass"',
						"      secure: false",
					].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes[0].name: expected non-empty string.",
			},
			{
				name: "blank node name",
				yaml: buildYaml({
					lavalinkBlock: [
						"lavalink:",
						"  nodes:",
						'    - name: ""',
						'      url: "localhost:2333"',
						'      auth: "file-pass"',
						"      secure: false",
					].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes[0].name: expected non-empty string.",
			},
			{
				name: "missing node url",
				yaml: buildYaml({
					lavalinkBlock: [
						"lavalink:",
						"  nodes:",
						'    - name: "file-node"',
						'      auth: "file-pass"',
						"      secure: false",
					].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes[0].url: expected non-empty string.",
			},
			{
				name: "blank node url",
				yaml: buildYaml({
					lavalinkBlock: [
						"lavalink:",
						"  nodes:",
						'    - name: "file-node"',
						'      url: ""',
						'      auth: "file-pass"',
						"      secure: false",
					].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes[0].url: expected non-empty string.",
			},
			{
				name: "missing node auth",
				yaml: buildYaml({
					lavalinkBlock: [
						"lavalink:",
						"  nodes:",
						'    - name: "file-node"',
						'      url: "localhost:2333"',
						"      secure: false",
					].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes[0].auth: expected non-empty string.",
			},
			{
				name: "blank node auth",
				yaml: buildYaml({
					lavalinkBlock: [
						"lavalink:",
						"  nodes:",
						'    - name: "file-node"',
						'      url: "localhost:2333"',
						'      auth: ""',
						"      secure: false",
					].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes[0].auth: expected non-empty string.",
			},
			{
				name: "non-boolean secure",
				yaml: buildYaml({
					lavalinkBlock: [
						"lavalink:",
						"  nodes:",
						'    - name: "file-node"',
						'      url: "localhost:2333"',
						'      auth: "file-pass"',
						'      secure: "no"',
					].join("\n"),
				}),
				expectedMessage:
					"Invalid config value for lavalink.nodes[0].secure: expected boolean.",
			},
		] as const;

		for (const testCase of lavalinkCases) {
			test(`${testCase.name} fails startup validation`, async () => {
				await expectLoadConfigError(testCase.yaml, testCase.expectedMessage);
			});
		}
	});
});
