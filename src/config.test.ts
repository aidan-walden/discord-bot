import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "./config";

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

type YamlOptions = {
	BOT_TOKEN?: string;
	DATABASE_URL?: string;
	BOT_OWNER_ID?: string;
	OPENAI_API_TOKEN?: string;
	OPENAI_MODEL?: string;
	adminUserIdsBlock?: string;
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
			await loadConfig(filePath);
			throw new Error("Expected loadConfig to throw.");
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

describe("loadConfig", () => {
	test("buildYaml() returns same string as base yaml fixture", () => {
		expect(buildYaml()).toBe(`${baseYaml}\n`);
	});

	describe("env over file precedence", () => {
		const precedenceCases = [
			{
				name: "BOT_TOKEN",
				env: { BOT_TOKEN: "env-bot-token" },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.BOT_TOKEN).toBe("env-bot-token");
				},
			},
			{
				name: "DATABASE_URL",
				env: { DATABASE_URL: "postgres://env-db" },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.DATABASE_URL).toBe("postgres://env-db");
				},
			},
			{
				name: "BOT_OWNER_ID",
				env: { BOT_OWNER_ID: "env-owner" },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.BOT_OWNER_ID).toBe("env-owner");
				},
			},
			{
				name: "OPENAI_MODEL",
				env: { OPENAI_MODEL: "env-model" },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.OPENAI_MODEL).toBe("env-model");
				},
			},
			{
				name: "OPENAI_API_TOKEN",
				env: { OPENAI_API_TOKEN: "env-openai-token" },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.OPENAI_API_TOKEN).toBe("env-openai-token");
				},
			},
		] as const;

		for (const testCase of precedenceCases) {
			test(`${testCase.name} uses non-empty env value over file`, async () => {
				await withEnv(testCase.env, async () => {
					const filePath = await writeTempConfig(buildYaml());
					const config = await loadConfig(filePath);

					testCase.assert(config);
				});
			});
		}

		const blankFallbackCases = [
			{
				name: "BOT_TOKEN",
				env: { BOT_TOKEN: "   " },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.BOT_TOKEN).toBe("file-bot-token");
				},
			},
			{
				name: "DATABASE_URL",
				env: { DATABASE_URL: "   " },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.DATABASE_URL).toBe("postgres://file-db");
				},
			},
			{
				name: "BOT_OWNER_ID",
				env: { BOT_OWNER_ID: "   " },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.BOT_OWNER_ID).toBe("file-owner");
				},
			},
			{
				name: "OPENAI_MODEL",
				env: { OPENAI_MODEL: "   " },
				assert: (config: Awaited<ReturnType<typeof loadConfig>>) => {
					expect(config.OPENAI_MODEL).toBe("file-model");
				},
			},
		] as const;

		for (const testCase of blankFallbackCases) {
			test(`${testCase.name} falls back to file when env value is blank`, async () => {
				await withEnv(testCase.env, async () => {
					const filePath = await writeTempConfig(buildYaml());
					const config = await loadConfig(filePath);

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
						await loadConfig(filePath);
						throw new Error("Expected loadConfig to throw.");
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
			const config = await loadConfig(filePath);

			expect(config.ADMIN_USER_IDS).toEqual(["admin-a", "admin-b"]);
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
