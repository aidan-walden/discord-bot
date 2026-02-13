import fs from "node:fs/promises";
import path from "node:path";

export interface LavalinkNodeConfig {
	name: string;
	url: string;
	auth: string;
	secure: boolean;
}

interface AppConfigFile {
	BOT_TOKEN?: string;
	OPENAI_API_TOKEN?: string;
	lavalink?: {
		nodes?: LavalinkNodeConfig[];
	};
}

export interface AppConfig {
	BOT_TOKEN: string;
	OPENAI_API_TOKEN?: string;
	lavalink: {
		nodes: LavalinkNodeConfig[];
	};
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function ensureString(value: unknown, key: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Invalid config value for ${key}: expected non-empty string.`);
	}
	return value;
}

function ensureBoolean(value: unknown, key: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`Invalid config value for ${key}: expected boolean.`);
	}
	return value;
}

function validateNodes(value: unknown): LavalinkNodeConfig[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error("Invalid config value for lavalink.nodes: expected non-empty array.");
	}

	return value.map((node, index) => {
		if (typeof node !== "object" || node === null) {
			throw new Error(`Invalid lavalink.nodes[${index}]: expected object.`);
		}

		const nodeRecord = node as Record<string, unknown>;
		return {
			name: ensureString(nodeRecord.name, `lavalink.nodes[${index}].name`),
			url: ensureString(nodeRecord.url, `lavalink.nodes[${index}].url`),
			auth: ensureString(nodeRecord.auth, `lavalink.nodes[${index}].auth`),
			secure: ensureBoolean(nodeRecord.secure, `lavalink.nodes[${index}].secure`),
		};
	});
}

export async function loadConfig(filePath: string = "config.yml"): Promise<AppConfig> {
	const resolvedPath = path.resolve(filePath);
	const fileContents = await fs.readFile(resolvedPath, "utf8").catch((error) => {
		throw new Error(`Failed to read config file at ${resolvedPath}: ${error}`);
	});

	const parsed = Bun.YAML.parse(fileContents);
	if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
		throw new Error(`Invalid config format in ${resolvedPath}: expected an object at root.`);
	}

	const configFile = parsed as AppConfigFile;
	const envBotToken = process.env.BOT_TOKEN;
	const configBotToken = configFile.BOT_TOKEN;
	const botToken = isNonEmptyString(envBotToken)
		? envBotToken
		: configBotToken;

	if (!isNonEmptyString(botToken)) {
		throw new Error(
			"BOT_TOKEN is not set. Define BOT_TOKEN in environment or set BOT_TOKEN in config.yml.",
		);
	}

	const openaiToken = process.env.OPENAI_API_TOKEN ?? configFile.OPENAI_API_TOKEN;
	const lavalinkNodes = validateNodes(configFile.lavalink?.nodes);

	return {
		BOT_TOKEN: botToken,
		OPENAI_API_TOKEN: openaiToken,
		lavalink: {
			nodes: lavalinkNodes,
		},
	};
}
