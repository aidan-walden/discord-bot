import path from "node:path";

export interface LavalinkNodeConfig {
	name: string;
	url: string;
	auth: string;
	secure: boolean;
}

interface AppConfigFile {
	BOT_TOKEN?: string;
	BOT_OWNER_ID?: string;
	DATABASE_URL?: string;
	OPENAI_API_TOKEN?: string;
	OPENAI_MODEL?: string;
	ADMIN_USER_IDS?: string[];
	lavalink?: {
		nodes?: LavalinkNodeConfig[];
	};
}

export interface AppConfig {
	BOT_TOKEN: string;
	DATABASE_URL: string;
	BOT_OWNER_ID: string;
	OPENAI_API_TOKEN?: string;
	OPENAI_MODEL?: string;
	ADMIN_USER_IDS: string[];
	lavalink: {
		nodes: LavalinkNodeConfig[];
	};
}

export interface ConfigClock {
	setTimeout(callback: () => void, delay: number): NodeJS.Timeout;
	clearTimeout(timeout: NodeJS.Timeout): void;
}

type ConfigSetValue<K extends keyof AppConfig> = NonNullable<
	AppConfig[K]
> | null;

const WRITE_DEBOUNCE_MS = 5_000;
const REAL_CLOCK: ConfigClock = {
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (timeout) => clearTimeout(timeout),
};

function ensureString(value: unknown, key: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(
			`Invalid config value for ${key}: expected non-empty string.`,
		);
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
		throw new Error(
			"Invalid config value for lavalink.nodes: expected non-empty array.",
		);
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
			secure: ensureBoolean(
				nodeRecord.secure,
				`lavalink.nodes[${index}].secure`,
			),
		};
	});
}

function validateAdminUserIds(value: unknown): string[] {
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error(
			"Invalid config value for ADMIN_USER_IDS: expected array of strings.",
		);
	}

	const adminUserIds = value.map((userId, index) =>
		ensureString(userId, `ADMIN_USER_IDS[${index}]`),
	);
	return [...new Set(adminUserIds)];
}

function validateConfigFile(configFile: AppConfigFile): AppConfig {
	const botToken = configFile.BOT_TOKEN;
	if (typeof botToken !== "string" || botToken.trim().length === 0) {
		throw new Error(
			"BOT_TOKEN is not set. Define BOT_TOKEN in environment or set BOT_TOKEN in config.yml.",
		);
	}

	const databaseUrl = configFile.DATABASE_URL;
	if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
		throw new Error(
			"DATABASE_URL is not set. Define DATABASE_URL in environment or set DATABASE_URL in config.yml.",
		);
	}

	const botOwnerId = configFile.BOT_OWNER_ID;
	if (typeof botOwnerId !== "string" || botOwnerId.trim().length === 0) {
		throw new Error(
			"BOT_OWNER_ID is not set. Define BOT_OWNER_ID in environment or set BOT_OWNER_ID in config.yml.",
		);
	}

	const adminUserIds = validateAdminUserIds(configFile.ADMIN_USER_IDS);
	const lavalinkNodes = validateNodes(configFile.lavalink?.nodes);

	return {
		BOT_TOKEN: botToken,
		BOT_OWNER_ID: botOwnerId,
		DATABASE_URL: databaseUrl,
		OPENAI_API_TOKEN: configFile.OPENAI_API_TOKEN,
		OPENAI_MODEL: configFile.OPENAI_MODEL,
		ADMIN_USER_IDS: adminUserIds,
		lavalink: {
			nodes: lavalinkNodes,
		},
	};
}

function getEnvironmentOverrides(): AppConfigFile {
	const overrides: AppConfigFile = {};

	for (const key of [
		"BOT_TOKEN",
		"DATABASE_URL",
		"BOT_OWNER_ID",
		"OPENAI_API_TOKEN",
		"OPENAI_MODEL",
	] as const) {
		const value = process.env[key];
		if (value !== undefined) {
			overrides[key] = value;
		}
	}

	return overrides;
}

function cloneConfigFile(configFile: AppConfigFile): AppConfigFile {
	const clone: AppConfigFile = {};

	if (configFile.BOT_TOKEN !== undefined) {
		clone.BOT_TOKEN = configFile.BOT_TOKEN;
	}

	if (configFile.DATABASE_URL !== undefined) {
		clone.DATABASE_URL = configFile.DATABASE_URL;
	}

	if (configFile.BOT_OWNER_ID !== undefined) {
		clone.BOT_OWNER_ID = configFile.BOT_OWNER_ID;
	}

	if (configFile.OPENAI_API_TOKEN !== undefined) {
		clone.OPENAI_API_TOKEN = configFile.OPENAI_API_TOKEN;
	}

	if (configFile.OPENAI_MODEL !== undefined) {
		clone.OPENAI_MODEL = configFile.OPENAI_MODEL;
	}

	if (configFile.ADMIN_USER_IDS !== undefined) {
		clone.ADMIN_USER_IDS = cloneConfigValue(configFile.ADMIN_USER_IDS);
	}

	if (configFile.lavalink !== undefined) {
		clone.lavalink = cloneConfigValue(configFile.lavalink);
	}

	return clone;
}

function cloneConfigValue<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		return structuredClone(value);
	}

	return value;
}

function parseConfigFile(parsed: unknown, resolvedPath: string): AppConfigFile {
	if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
		throw new Error(
			`Invalid config format in ${resolvedPath}: expected an object at root.`,
		);
	}

	return cloneConfigFile(parsed as AppConfigFile);
}

function applyEnvironmentOverrides(
	configFile: AppConfigFile,
	environmentOverrides: AppConfigFile,
): AppConfigFile {
	return {
		...cloneConfigFile(configFile),
		...cloneConfigFile(environmentOverrides),
	};
}

function serializeConfigFile(configFile: AppConfigFile): string {
	const serializable = cloneConfigFile(configFile);
	const serialized = Bun.YAML.stringify(serializable);
	return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

export class Config {
	private fileConfig: AppConfigFile;
	private dirty = false;
	private activeWritePromise: Promise<void> | null = null;
	private pendingWrite: NodeJS.Timeout | null = null;
	private version = 0;

	private constructor(
		private readonly filePath: string,
		fileConfig: AppConfigFile,
		private readonly environmentOverrides: AppConfigFile,
		private readonly clock: ConfigClock,
	) {
		this.fileConfig = cloneConfigFile(fileConfig);
		validateConfigFile(this.getEffectiveConfigFile());
	}

	public static async load(
		filePath: string = "config.yml",
		clock: ConfigClock = REAL_CLOCK,
	): Promise<Config> {
		const resolvedPath = path.resolve(filePath);
		const fileContents = await Bun.file(resolvedPath)
			.text()
			.catch((error) => {
				throw new Error(
					`Failed to read config file at ${resolvedPath}: ${error}`,
				);
			});

		const fileConfig = parseConfigFile(
			Bun.YAML.parse(fileContents),
			resolvedPath,
		);
		return new Config(
			resolvedPath,
			fileConfig,
			getEnvironmentOverrides(),
			clock,
		);
	}

	public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
		return cloneConfigValue(
			validateConfigFile(this.getEffectiveConfigFile())[key],
		);
	}

	public set<K extends keyof AppConfig>(
		key: K,
		value: ConfigSetValue<K>,
	): void {
		if (value === undefined) {
			console.warn(
				`undefined passed to Config.set for key ${key.toString()}, ignoring...`,
			);
			return;
		}

		const nextConfig = cloneConfigFile(this.fileConfig);

		if (value === null) {
			delete nextConfig[key];
		} else {
			this.setFileConfigValue(nextConfig, key, value);
		}

		validateConfigFile(this.getEffectiveConfigFile(nextConfig));

		this.fileConfig = nextConfig;
		this.dirty = true;
		this.version += 1;
		this.scheduleWrite();
	}

	public async flush(): Promise<void> {
		this.clearPendingWrite();
		if (this.activeWritePromise) {
			await this.activeWritePromise;
			return;
		}

		await this.writeToDisk();
	}

	private getEffectiveConfigFile(configFile: AppConfigFile = this.fileConfig) {
		return applyEnvironmentOverrides(configFile, this.environmentOverrides);
	}

	private setFileConfigValue<K extends keyof AppConfig>(
		configFile: AppConfigFile,
		key: K,
		value: NonNullable<AppConfig[K]>,
	): void {
		const clonedValue = cloneConfigValue(value);

		switch (key) {
			case "BOT_TOKEN":
				configFile.BOT_TOKEN = clonedValue as AppConfig["BOT_TOKEN"];
				return;
			case "DATABASE_URL":
				configFile.DATABASE_URL = clonedValue as AppConfig["DATABASE_URL"];
				return;
			case "BOT_OWNER_ID":
				configFile.BOT_OWNER_ID = clonedValue as AppConfig["BOT_OWNER_ID"];
				return;
			case "OPENAI_API_TOKEN":
				configFile.OPENAI_API_TOKEN =
					clonedValue as AppConfig["OPENAI_API_TOKEN"];
				return;
			case "OPENAI_MODEL":
				configFile.OPENAI_MODEL = clonedValue as AppConfig["OPENAI_MODEL"];
				return;
			case "ADMIN_USER_IDS":
				configFile.ADMIN_USER_IDS = clonedValue as AppConfig["ADMIN_USER_IDS"];
				return;
			case "lavalink":
				configFile.lavalink = clonedValue as AppConfig["lavalink"];
				return;
		}
	}

	private scheduleWrite(): void {
		this.clearPendingWrite();
		this.pendingWrite = this.clock.setTimeout(() => {
			this.pendingWrite = null;
			this.startScheduledWrite();
		}, WRITE_DEBOUNCE_MS);
	}

	private startScheduledWrite(): void {
		const writePromise = this.writeToDisk();
		this.activeWritePromise = writePromise;

		void writePromise
			.catch((error) => {
				console.error("Failed to write config file:", error);
			})
			.finally(() => {
				if (this.activeWritePromise === writePromise) {
					this.activeWritePromise = null;
				}
			});
	}

	private clearPendingWrite(): void {
		if (this.pendingWrite) {
			this.clock.clearTimeout(this.pendingWrite);
			this.pendingWrite = null;
		}
	}

	private async writeToDisk(): Promise<void> {
		if (!this.dirty) {
			return;
		}

		const writeVersion = this.version;
		await Bun.write(this.filePath, serializeConfigFile(this.fileConfig));

		if (this.version === writeVersion) {
			this.dirty = false;
		}
	}
}
