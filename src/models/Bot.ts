/**
 * Main bot class that extends the Discord.js Client class.
 * This class exists so that we can easily add properties and methods to the bot.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import {
	Client,
	type ClientEvents,
	Collection,
	Events,
	GatewayIntentBits,
	type RESTGetAPIApplicationCommandsResult,
	type RESTGetAPIApplicationGuildCommandsResult,
	Routes,
	type Snowflake,
} from "discord.js";
import { Kazagumo } from "kazagumo";
import OpenAI from "openai";
import { Connectors } from "shoukaku";
import type { Config, ProfilePictureState } from "../config";
import { migrateDatabase } from "../database/migrate";
import {
	ProfilePictureValidationError,
	validateRemoteProfilePictureMime,
} from "../helpers/profilePicture";
import BanRepository from "../repositories/BanRepository";
import DeafenSessionRepository from "../repositories/DeafenSessionRepository";
import GuildSettingsRepository from "../repositories/GuildSettingsRepository";
import RiotMatchRepository from "../repositories/RiotMatchRepository";
import RiotMatchSyncRepository from "../repositories/RiotMatchSyncRepository";
import RiotRankHistoryRepository from "../repositories/RiotRankHistoryRepository";
import RiotUserLinkRepository from "../repositories/RiotUserLinkRepository";
import SecretSantaRepository from "../repositories/SecretSantaRepository";
import UserBalanceRepository from "../repositories/UserBalanceRepository";
import AppleMusicService from "../services/AppleMusicService";
import ChatSessionService from "../services/ChatSessionService";
import DeafenTrackerService, {
	isDeafenTrackerActive,
} from "../services/DeafenTrackerService";
import HolidayProvider from "../services/HolidayProvider";
import MetricsCollector from "../services/MetricsCollector";
import MusicLinkService from "../services/MusicLinkService";
import PermissionService from "../services/PermissionService";
import RiotGamesService from "../services/RiotGamesService";
import SpotifyClientCredentialsStrategy from "../services/SpotifyClientCredentialsStrategy";
import SpotifyService from "../services/SpotifyService";
import type BotEvent from "./BotEvent";
import { BotEvents } from "./BotEvents";
import type Command from "./Command";
import type Holiday from "./Holiday";

function isRuntimeTypescriptModule(file: string): boolean {
	return file.endsWith(".ts") && !file.endsWith(".test.ts");
}

export default class Bot extends Client {
	override readonly bot: Bot = this;
	readonly commands: Collection<string, Command>;
	readonly music: Kazagumo;
	readonly adminUserIds: ReadonlySet<string>;
	readonly config: Config;
	readonly db: typeof Bun.sql;
	readonly openai: OpenAI | null;
	readonly permissions: PermissionService;
	readonly chatSessions: ChatSessionService;
	readonly spotify: SpotifyService;
	readonly appleMusic: AppleMusicService;
	readonly musicLinks: MusicLinkService;
	readonly balances: UserBalanceRepository;
	readonly deafenSessions: DeafenSessionRepository;
	readonly deafenTracker: DeafenTrackerService;
	readonly metrics: MetricsCollector;
	readonly holidays: HolidayProvider;
	readonly riot: RiotGamesService;
	readonly riotLinks: RiotUserLinkRepository;
	readonly riotMatches: RiotMatchRepository;
	readonly guildSettings: GuildSettingsRepository;
	readonly secretSanta: SecretSantaRepository;

	private readonly shouldDeployCommands: boolean;
	private readonly shouldRemoveCommands: boolean;
	private readonly deployGuildId: string | undefined;

	constructor(
		config: Config,
		shouldDeployCommands: boolean = false,
		shouldRemoveCommands: boolean = false,
		guildId: string | undefined = undefined,
	) {
		const intents = [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.GuildVoiceStates,
		];
		// The privileged presence intent is only requested when the deafen tracker is
		// actually active, so the bot does not require the portal toggle otherwise.
		if (isDeafenTrackerActive(config.get("deafentracker"))) {
			intents.push(GatewayIntentBits.GuildPresences);
		}
		super({ intents });
		this.config = config;
		this.shouldDeployCommands = shouldDeployCommands;
		this.shouldRemoveCommands = shouldRemoveCommands;
		this.deployGuildId = guildId;
		this.commands = new Collection<string, Command>();
		this.adminUserIds = new Set([
			config.get("BOT_OWNER_ID"),
			...config.get("ADMIN_USER_IDS"),
		]);
		this.db = new Bun.SQL(config.get("DATABASE_URL"));
		this.metrics = new MetricsCollector();
		const openaiConfig = config.get("openai");
		this.openai = openaiConfig.OPENAI_API_TOKEN
			? new OpenAI({ apiKey: openaiConfig.OPENAI_API_TOKEN })
			: null;
		this.permissions = new PermissionService(
			this.adminUserIds,
			new BanRepository(this.db, "gpt_user_bans", "user_id"),
			new BanRepository(this.db, "music_user_bans", "user_id"),
			new BanRepository(this.db, "music_guild_bans", "guild_id"),
		);
		this.balances = new UserBalanceRepository(this.db);
		this.deafenSessions = new DeafenSessionRepository(this.db);
		this.deafenTracker = new DeafenTrackerService(this.deafenSessions);
		this.riotLinks = new RiotUserLinkRepository(this.db);
		this.riotMatches = new RiotMatchRepository(this.db);
		this.guildSettings = new GuildSettingsRepository(this.db);
		this.secretSanta = new SecretSantaRepository(this.db);
		this.chatSessions = new ChatSessionService(
			this.openai,
			openaiConfig.OPENAI_MODEL,
			this.metrics,
		);

		const spotifyConfig = config.get("spotify");
		const spotifyClient =
			spotifyConfig.SPOTIFY_CLIENT_ID && spotifyConfig.SPOTIFY_CLIENT_SECRET
				? new SpotifyApi(
						new SpotifyClientCredentialsStrategy(
							spotifyConfig.SPOTIFY_CLIENT_ID,
							spotifyConfig.SPOTIFY_CLIENT_SECRET,
							this.metrics,
						),
					)
				: null;
		this.spotify = new SpotifyService(spotifyClient, this.metrics);
		this.appleMusic = new AppleMusicService();
		this.musicLinks = new MusicLinkService(this.spotify, this.appleMusic);
		const riotConfig = config.get("riot");
		const riotApiKey = riotConfig.RIOT_API_KEY?.trim() || null;
		this.riot = new RiotGamesService(riotApiKey, this.metrics, {
			pollIntervalSeconds: riotConfig.pollIntervalSeconds,
			players: riotConfig.players,
			rankHistory: new RiotRankHistoryRepository(this.db),
			matches: this.riotMatches,
			matchSync: new RiotMatchSyncRepository(this.db),
			userLinks: this.riotLinks,
		});

		this.holidays = new HolidayProvider();

		// TODO: Change search engine to youtube
		this.music = new Kazagumo(
			{
				defaultSearchEngine: "soundcloud",
				send: (guildId, payload) => {
					const guild = this.guilds.cache.get(guildId);
					if (guild) guild.shard.send(payload);
				},
			},
			new Connectors.DiscordJS(this),
			config.get("lavalink").nodes,
		);

		// Lavalink events
		// Dervied from Kazagumo readme
		this.music.shoukaku.on("ready", (name) =>
			console.log(`Lavalink ${name}: Ready!`),
		);
		this.music.shoukaku.on("error", (name, error) =>
			console.error(`Lavalink ${name}: Error Caught,`, error),
		);
		this.music.shoukaku.on("close", (name, code, reason) =>
			console.warn(
				`Lavalink ${name}: Closed, Code ${code}, Reason ${reason || "No reason"}`,
			),
		);
		this.music.shoukaku.on("debug", (name, info) =>
			console.debug(`Lavalink ${name}: Debug,`, info),
		);
		this.music.shoukaku.on("disconnect", (name) => {
			const players = [...this.music.shoukaku.players.values()].filter(
				(p) => p.node.name === name,
			);
			players.forEach(async (player) => {
				this.music.destroyPlayer(player.guildId);
				await player.destroy();
			});
			console.warn(`Lavalink ${name}: Destroyed`);
		});

		this.holidays.on("change", (holiday) => {
			this.emit(BotEvents.HolidayChange, holiday);
		});
	}

	async initialize(): Promise<void> {
		await migrateDatabase(this.db);
		await this.registerCommands(path.join(import.meta.dirname, "../commands"));
		await this.registerEvents(path.join(import.meta.dirname, "../events"));

		// Bot must be ready to deploy or remove commands, as we need to access the bot user's ID.
		this.once(Events.ClientReady, async () => {
			if (this.shouldDeployCommands) {
				await this.deployCommands(this.deployGuildId).catch((error) => {
					console.error("Error deploying commands:", error);
				});
			}
			if (this.shouldRemoveCommands) {
				await this.removeCommands(this.deployGuildId).catch((error) => {
					console.error("Error removing commands:", error);
				});
			}

			this.holidays.start();
			this.riot.startPoller();
		});
	}

	async setProfilePicture(
		profilePicturePath: string,
		force: boolean,
	): Promise<void> {
		if (this.config.get("profilePicture")?.forced === true && !force) {
			return;
		}

		await validateRemoteProfilePictureMime(profilePicturePath);

		if (!this.user) {
			throw new Error("Bot user not found");
		}

		const profilePicture: ProfilePictureState = {
			path: profilePicturePath,
			forced: force,
		};

		await this.user.setAvatar(profilePicturePath);
		this.config.set("profilePicture", profilePicture);
		await this.config.flush();
	}

	async releaseProfilePictureOverride(): Promise<void> {
		const profilePicture = this.config.get("profilePicture");
		if (!profilePicture) {
			return;
		}

		this.config.set("profilePicture", {
			...profilePicture,
			forced: false,
		});
		await this.config.flush();
	}

	async applyHolidayProfilePicture(holiday: Holiday | null): Promise<void> {
		const holidayProfilePictures = this.config.get("holidayProfilePictures");
		if (!holidayProfilePictures) {
			return;
		}

		const baseProfilePicture = this.config.get("baseProfilePicture");
		if (!baseProfilePicture) {
			console.warn(
				"holidayProfilePictures is configured but baseProfilePicture is not. Skipping profile picture for holiday...",
			);
			return;
		}

		const profilePicture =
			holiday === null
				? baseProfilePicture
				: (holidayProfilePictures[holiday] ?? baseProfilePicture);

		try {
			await this.setProfilePicture(profilePicture, false);
		} catch (error) {
			if (error instanceof ProfilePictureValidationError) {
				console.warn(
					`Skipping configured holiday profile picture because ${error.message}`,
				);
				return;
			}

			console.error("Failed to update holiday profile picture:", error);
		}
	}

	/**
	 * Register all events in the given directory, to be executed by the bot when the event is triggered.
	 * @param {string} rootDir - The root directory to search for event files.
	 */
	private async registerEvents(rootDir: string): Promise<void> {
		const eventFiles = (await fs.readdir(rootDir)).filter(
			isRuntimeTypescriptModule,
		);
		for (const file of eventFiles) {
			const filePath = path.join(rootDir, file);

			// Create instance of event class before accessing its properties
			const EventClass = (await import(filePath)).default as new () => BotEvent;
			const event = new EventClass();
			if (event.isEnabled && !event.isEnabled(this)) {
				continue;
			}
			if (event.once) {
				this.once(event.event as keyof ClientEvents, (...args) =>
					event.execute(this, ...args),
				);
			} else {
				this.on(event.event as keyof ClientEvents, (...args) =>
					event.execute(this, ...args),
				);
			}
		}
	}

	/**
	 * Register all commands in the given directory, to be executed by the bot when the command is triggered.
	 * @param {string} rootDir - The root directory to search for command files.
	 */
	private async registerCommands(rootDir: string): Promise<void> {
		const commandFolders = await fs.readdir(rootDir);
		for (const folder of commandFolders) {
			const commandFolderPath = path.join(rootDir, folder);
			const commandFiles = (await fs.readdir(commandFolderPath)).filter(
				isRuntimeTypescriptModule,
			);
			for (const file of commandFiles) {
				const filePath = path.join(commandFolderPath, file);

				// Create instance of command class before accessing its properties
				const CommandClass = (await import(filePath))
					.default as new () => Command;
				const command = new CommandClass();
				this.commands.set(command.data.name, command);
			}
		}
	}

	/**
	 * Deploy all registered commands to the given guild, or globally if no guild is provided.
	 * @param {string} guildId - The guild ID to deploy the commands to.
	 * @throws {Error} If the bot user is not found.
	 */
	async deployCommands(guildId: string | undefined): Promise<void> {
		if (!this.user) {
			throw new Error("Bot user not found");
		}

		if (guildId) {
			console.log(`Deploying commands to guild ${guildId}...`);
			await this.rest.put(
				Routes.applicationGuildCommands(this.user.id, guildId),
				{
					body: this.commands.map((command) => command.data.toJSON()),
				},
			);
			console.log(`Done deploying commands to guild ${guildId}`);
		} else {
			console.log(`Deploying commands globally...`);
			await this.rest.put(Routes.applicationCommands(this.user.id), {
				body: this.commands.map((command) => command.data.toJSON()),
			});
			console.log(`Done deploying commands globally`);
		}
	}

	/**
	 * Remove all deployed commands from the given guild, or globally if no guild is provided.
	 * @param {string} guildId - The guild ID to remove the commands from.
	 * @throws {Error} If the bot user is not found.
	 */
	async removeCommands(guildId: string | undefined): Promise<void> {
		if (!this.user) {
			throw new Error("Bot user not found");
		}

		if (guildId) {
			console.log(`Removing deployed commands from guild ${guildId}...`);
			const commands = (await this.rest.get(
				Routes.applicationGuildCommands(this.user.id, guildId),
			)) as RESTGetAPIApplicationGuildCommandsResult;
			for (const command of commands) {
				await this.rest.delete(
					Routes.applicationGuildCommand(this.user.id, guildId, command.id),
				);
			}
			console.log(`Done removing commands from guild ${guildId}`);
		} else {
			console.log(`Removing deployed commands globally...`);
			const commands = (await this.rest.get(
				Routes.applicationCommands(this.user.id),
			)) as RESTGetAPIApplicationCommandsResult;
			for (const command of commands) {
				await this.rest.delete(
					Routes.applicationCommand(this.user.id, command.id as Snowflake),
				);
			}
			console.log(`Done removing commands globally`);
		}
	}
}

// Extend the Discord.js Client class to include the bot property.
// This is so that we can easily access the bot property from the client instance.
declare module "discord.js" {
	interface Client {
		bot: Bot;
	}
}
