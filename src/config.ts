import { statSync } from "node:fs";
import path from "node:path";
import { isHttpImageUrl } from "./helpers/profilePicture";
import Holiday from "./models/Holiday";
import { parseRiotId, RIOT_PLATFORMS } from "./services/riot/constants";
import type { RiotPlatform, RiotPlayerConfig } from "./services/riot/types";

export type { RiotPlayerConfig };

export interface LavalinkNodeConfig {
	name: string;
	url: string;
	auth: string;
	secure: boolean;
}

export interface ProfilePictureState {
	path: string;
	forced: boolean;
}

export type HolidayProfilePicturesConfig = Partial<Record<Holiday, string>>;

export interface DeafenTrackerConfig {
	enabled: boolean;
	muted_is_deafened: boolean;
	users: string[];
}

export interface OpenAIConfig {
	OPENAI_API_TOKEN?: string;
	OPENAI_MODEL?: string;
}

export interface AnthropicConfig {
	ANTHROPIC_API_TOKEN?: string;
	ANTHROPIC_MODEL?: string;
}

export interface SpotifyConfig {
	SPOTIFY_CLIENT_ID?: string;
	SPOTIFY_CLIENT_SECRET?: string;
}

export interface TikTokConfig {
	TIKTOK_SESSION_ID?: string;
}

export interface ImgurConfig {
	IMGUR_CLIENT_ID?: string;
}

export interface RiotConfig {
	RIOT_API_KEY?: string;
	pollIntervalSeconds: number;
	players: RiotPlayerConfig[];
}

interface AppConfigFile {
	BOT_TOKEN?: string;
	BOT_OWNER_ID?: string;
	DATABASE_URL?: string;
	ADMIN_USER_IDS?: string[];
	profilePicture?: ProfilePictureState;
	baseProfilePicture?: string;
	holidayProfilePictures?: HolidayProfilePicturesConfig;
	deafentracker?: {
		enabled?: boolean;
		muted_is_deafened?: boolean;
		users?: string[];
	};
	openai?: OpenAIConfig;
	anthropic?: AnthropicConfig;
	spotify?: SpotifyConfig;
	tiktok?: TikTokConfig;
	imgur?: ImgurConfig;
	riot?: {
		RIOT_API_KEY?: string;
		pollIntervalSeconds?: number;
		players?: Array<{
			puuid?: string;
			riotId?: string;
			platform?: string;
		}>;
	};
	lavalink?: {
		nodes?: LavalinkNodeConfig[];
	};
}

export interface AppConfig {
	BOT_TOKEN: string;
	DATABASE_URL: string;
	BOT_OWNER_ID: string;
	ADMIN_USER_IDS: string[];
	profilePicture?: ProfilePictureState;
	baseProfilePicture?: string;
	holidayProfilePictures?: HolidayProfilePicturesConfig;
	deafentracker: DeafenTrackerConfig;
	openai: OpenAIConfig;
	anthropic: AnthropicConfig;
	spotify: SpotifyConfig;
	tiktok: TikTokConfig;
	imgur: ImgurConfig;
	riot: RiotConfig;
	lavalink: {
		nodes: LavalinkNodeConfig[];
	};
}

const FLAT_ENV_KEYS = ["BOT_TOKEN", "DATABASE_URL", "BOT_OWNER_ID"] as const;

const NESTED_ENV_KEYS = {
	openai: ["OPENAI_API_TOKEN", "OPENAI_MODEL"],
	anthropic: ["ANTHROPIC_API_TOKEN", "ANTHROPIC_MODEL"],
	spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
	tiktok: ["TIKTOK_SESSION_ID"],
	imgur: ["IMGUR_CLIENT_ID"],
	riot: ["RIOT_API_KEY"],
} as const;

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
const HOLIDAY_VALUES = new Set<string>(Object.values(Holiday));

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

function validateDeafenTrackerUsers(value: unknown): string[] {
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error(
			"Invalid config value for deafentracker.users: expected array of strings.",
		);
	}

	const users = value.map((userId, index) =>
		ensureString(userId, `deafentracker.users[${index}]`),
	);
	return [...new Set(users)];
}

function validateDeafenTracker(value: unknown): DeafenTrackerConfig {
	if (value === undefined) {
		return { enabled: false, muted_is_deafened: false, users: [] };
	}

	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid config value for deafentracker: expected object.");
	}

	const record = value as Record<string, unknown>;
	return {
		enabled:
			record.enabled === undefined
				? false
				: ensureBoolean(record.enabled, "deafentracker.enabled"),
		muted_is_deafened:
			record.muted_is_deafened === undefined
				? false
				: ensureBoolean(
						record.muted_is_deafened,
						"deafentracker.muted_is_deafened",
					),
		users: validateDeafenTrackerUsers(record.users),
	};
}

const RIOT_PLATFORM_SET = new Set<string>(RIOT_PLATFORMS);
const DEFAULT_RIOT_POLL_INTERVAL_SECONDS = 60;

function validateRiotPlayers(value: unknown): RiotPlayerConfig[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		throw new Error(
			"Invalid config value for riot.players: expected array of objects.",
		);
	}
	return value.map((player, index) => {
		if (
			typeof player !== "object" ||
			player === null ||
			Array.isArray(player)
		) {
			throw new Error(`Invalid riot.players[${index}]: expected object.`);
		}
		const record = player as Record<string, unknown>;
		const platform = ensureString(
			record.platform,
			`riot.players[${index}].platform`,
		);
		if (!RIOT_PLATFORM_SET.has(platform)) {
			throw new Error(
				`Invalid riot.players[${index}].platform: expected one of ${RIOT_PLATFORMS.join(", ")}.`,
			);
		}
		const hasPuuid =
			record.puuid !== undefined &&
			!(typeof record.puuid === "string" && record.puuid.trim() === "");
		const hasRiotId =
			record.riotId !== undefined &&
			!(typeof record.riotId === "string" && record.riotId.trim() === "");
		if (hasPuuid === hasRiotId) {
			throw new Error(
				`Invalid riot.players[${index}]: set exactly one of puuid or riotId.`,
			);
		}
		if (hasRiotId) {
			const riotId = ensureString(
				record.riotId,
				`riot.players[${index}].riotId`,
			);
			if (!parseRiotId(riotId)) {
				throw new Error(
					`Invalid riot.players[${index}].riotId: expected GameName#TAG.`,
				);
			}
			return { riotId, platform: platform as RiotPlatform };
		}
		return {
			puuid: ensureString(record.puuid, `riot.players[${index}].puuid`),
			platform: platform as RiotPlatform,
		};
	});
}

function pickOptionalString(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return value === undefined ? undefined : (value as string);
}

function validateApiCategory(
	value: unknown,
	category: string,
): Record<string, unknown> {
	if (value === undefined) {
		return {};
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`Invalid config value for ${category}: expected object.`);
	}
	return value as Record<string, unknown>;
}

function withOptionalStringField<T extends object>(
	result: T,
	record: Record<string, unknown>,
	key: string,
): T {
	const value = pickOptionalString(record, key);
	if (value !== undefined) {
		(result as Record<string, string>)[key] = value;
	}
	return result;
}

function validateOpenAI(value: unknown): OpenAIConfig {
	const record = validateApiCategory(value, "openai");
	let result: OpenAIConfig = {};
	result = withOptionalStringField(result, record, "OPENAI_API_TOKEN");
	result = withOptionalStringField(result, record, "OPENAI_MODEL");
	return result;
}

function validateAnthropic(value: unknown): AnthropicConfig {
	const record = validateApiCategory(value, "anthropic");
	let result: AnthropicConfig = {};
	result = withOptionalStringField(result, record, "ANTHROPIC_API_TOKEN");
	result = withOptionalStringField(result, record, "ANTHROPIC_MODEL");
	return result;
}

function validateSpotify(value: unknown): SpotifyConfig {
	const record = validateApiCategory(value, "spotify");
	let result: SpotifyConfig = {};
	result = withOptionalStringField(result, record, "SPOTIFY_CLIENT_ID");
	result = withOptionalStringField(result, record, "SPOTIFY_CLIENT_SECRET");
	return result;
}

function validateTikTok(value: unknown): TikTokConfig {
	const record = validateApiCategory(value, "tiktok");
	return withOptionalStringField({}, record, "TIKTOK_SESSION_ID");
}

function validateImgur(value: unknown): ImgurConfig {
	const record = validateApiCategory(value, "imgur");
	return withOptionalStringField({}, record, "IMGUR_CLIENT_ID");
}

function validateRiot(value: unknown): RiotConfig {
	if (value === undefined) {
		return {
			pollIntervalSeconds: DEFAULT_RIOT_POLL_INTERVAL_SECONDS,
			players: [],
		};
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Invalid config value for riot: expected object.");
	}
	const record = value as Record<string, unknown>;
	let pollIntervalSeconds = DEFAULT_RIOT_POLL_INTERVAL_SECONDS;
	if (record.pollIntervalSeconds !== undefined) {
		if (
			typeof record.pollIntervalSeconds !== "number" ||
			!Number.isFinite(record.pollIntervalSeconds) ||
			record.pollIntervalSeconds <= 0
		) {
			throw new Error(
				"Invalid config value for riot.pollIntervalSeconds: expected positive number.",
			);
		}
		pollIntervalSeconds = record.pollIntervalSeconds;
	}
	return withOptionalStringField(
		{
			pollIntervalSeconds,
			players: validateRiotPlayers(record.players),
		},
		record,
		"RIOT_API_KEY",
	);
}

function validateProfilePicture(
	value: unknown,
): ProfilePictureState | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(
			"Invalid config value for profilePicture: expected object.",
		);
	}

	const profilePicture = value as Record<string, unknown>;
	return {
		path: ensureString(profilePicture.path, "profilePicture.path"),
		forced: ensureBoolean(profilePicture.forced, "profilePicture.forced"),
	};
}

function validateProfilePicturePath(
	value: unknown,
	key: string,
	configDirectory: string,
): string {
	const profilePicturePath = ensureString(value, key);

	if (isHttpImageUrl(profilePicturePath)) {
		return profilePicturePath;
	}

	const resolvedPath = path.isAbsolute(profilePicturePath)
		? profilePicturePath
		: path.resolve(configDirectory, profilePicturePath);

	try {
		if (!statSync(resolvedPath).isFile()) {
			throw new Error("not a file");
		}
	} catch {
		throw new Error(
			`Invalid config value for ${key}: expected an existing local file path or direct HTTP(S) image URL.`,
		);
	}

	return profilePicturePath;
}

function validateBaseProfilePicture(
	value: unknown,
	configDirectory: string,
): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	return validateProfilePicturePath(
		value,
		"baseProfilePicture",
		configDirectory,
	);
}

function validateHolidayProfilePictures(
	value: unknown,
	configDirectory: string,
): HolidayProfilePicturesConfig | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(
			"Invalid config value for holidayProfilePictures: expected object.",
		);
	}

	const holidayProfilePictures: Record<string, string> = {};
	for (const [holiday, profilePicturePath] of Object.entries(value)) {
		if (!HOLIDAY_VALUES.has(holiday)) {
			throw new Error(
				`Invalid config value for holidayProfilePictures.${holiday}: expected a holiday defined in Holiday.ts.`,
			);
		}

		holidayProfilePictures[holiday] = validateProfilePicturePath(
			profilePicturePath,
			`holidayProfilePictures.${holiday}`,
			configDirectory,
		);
	}

	return holidayProfilePictures;
}

function validateConfigFile(
	configFile: AppConfigFile,
	configDirectory: string,
): AppConfig {
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
	const deafentracker = validateDeafenTracker(configFile.deafentracker);
	const openai = validateOpenAI(configFile.openai);
	const anthropic = validateAnthropic(configFile.anthropic);
	const spotify = validateSpotify(configFile.spotify);
	const tiktok = validateTikTok(configFile.tiktok);
	const imgur = validateImgur(configFile.imgur);
	const riot = validateRiot(configFile.riot);
	const lavalinkNodes = validateNodes(configFile.lavalink?.nodes);
	const profilePicture = validateProfilePicture(configFile.profilePicture);
	const baseProfilePicture = validateBaseProfilePicture(
		configFile.baseProfilePicture,
		configDirectory,
	);
	const holidayProfilePictures = validateHolidayProfilePictures(
		configFile.holidayProfilePictures,
		configDirectory,
	);

	return {
		BOT_TOKEN: botToken,
		BOT_OWNER_ID: botOwnerId,
		DATABASE_URL: databaseUrl,
		ADMIN_USER_IDS: adminUserIds,
		profilePicture,
		baseProfilePicture,
		holidayProfilePictures,
		deafentracker,
		openai,
		anthropic,
		spotify,
		tiktok,
		imgur,
		riot,
		lavalink: {
			nodes: lavalinkNodes,
		},
	};
}

function getEnvironmentOverrides(): AppConfigFile {
	const overrides: AppConfigFile = {};

	for (const key of FLAT_ENV_KEYS) {
		const value = process.env[key];
		if (value !== undefined) {
			overrides[key] = value;
		}
	}

	for (const [category, keys] of Object.entries(NESTED_ENV_KEYS) as Array<
		[keyof typeof NESTED_ENV_KEYS, readonly string[]]
	>) {
		const nested: Record<string, string> = {};
		let hasValue = false;
		for (const key of keys) {
			const value = process.env[key];
			if (value !== undefined) {
				nested[key] = value;
				hasValue = true;
			}
		}
		if (hasValue) {
			overrides[category] = nested as AppConfigFile[typeof category];
		}
	}

	return overrides;
}

function cloneConfigFile(configFile: AppConfigFile): AppConfigFile {
	return structuredClone(configFile);
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
	const next = cloneConfigFile(configFile);
	const env = cloneConfigFile(environmentOverrides);

	for (const key of FLAT_ENV_KEYS) {
		if (env[key] !== undefined) {
			next[key] = env[key];
		}
	}

	for (const category of Object.keys(NESTED_ENV_KEYS) as Array<
		keyof typeof NESTED_ENV_KEYS
	>) {
		if (env[category] !== undefined) {
			next[category] = {
				...next[category],
				...env[category],
			} as AppConfigFile[typeof category];
		}
	}

	return next;
}

function serializeConfigFile(configFile: AppConfigFile): string {
	const serializable = cloneConfigFile(configFile);
	const serialized = Bun.YAML.stringify(serializable);
	return serialized.endsWith("\n") ? serialized : `${serialized}\n`;
}

export class Config {
	private fileConfig: AppConfigFile;
	private loadedConfig: AppConfig;
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
		this.loadedConfig = validateConfigFile(
			this.getEffectiveConfigFile(),
			path.dirname(this.filePath),
		);
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
		return this.loadedConfig[key];
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
			nextConfig[key] = cloneConfigValue(value) as AppConfigFile[K];
		}

		const nextLoadedConfig = validateConfigFile(
			this.getEffectiveConfigFile(nextConfig),
			path.dirname(this.filePath),
		);

		this.fileConfig = nextConfig;
		this.loadedConfig = nextLoadedConfig;
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
