import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	type DiscordGatewayAdapterCreator,
	entersState,
	getVoiceConnection,
	joinVoiceChannel,
	StreamType,
	type VoiceConnection,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Client } from "discord.js";
import { Kazagumo, type KazagumoPlayer } from "kazagumo";
import { Connectors } from "shoukaku";

/** Time the bot stays in a voice channel after TTS playback finishes. */
export const TTS_IDLE_LEAVE_MS = 30_000;

export type VoiceOwner = "music" | "tts" | "none";

type KazagumoNodes = ConstructorParameters<typeof Kazagumo>[2];

/** Thrown when a voice request conflicts with the current owner of the guild's voice connection. */
export class VoiceBusyError extends Error {
	constructor(
		message: string = "TikTok TTS cannot play while music is active. Choose attachment mode instead.",
	) {
		super(message);
		this.name = "VoiceBusyError";
	}
}

type TtsSession = {
	player: AudioPlayer;
	connection: VoiceConnection;
};

/** Injection points for tests. */
export type VoiceSessionDeps = {
	createKazagumo: (client: Client, nodes: KazagumoNodes) => Kazagumo;
	joinVoiceChannel: typeof joinVoiceChannel;
	createAudioPlayer: typeof createAudioPlayer;
	createAudioResource: typeof createAudioResource;
	entersState: typeof entersState;
	getVoiceConnection: typeof getVoiceConnection;
	ttsIdleLeaveMs: number;
};

function defaultCreateKazagumo(client: Client, nodes: KazagumoNodes): Kazagumo {
	return new Kazagumo(
		{
			defaultSearchEngine: "youtube",
			send: (guildId, payload) => {
				const guild = client.guilds.cache.get(guildId);
				if (guild) guild.shard.send(payload);
			},
		},
		new Connectors.DiscordJS(client),
		nodes,
	);
}

/**
 * Owns every per-guild bot voice connection: music (Kazagumo/Lavalink players)
 * and TikTok TTS (@discordjs/voice). A guild's voice is owned by music, TTS, or
 * nobody. TTS leaves after {@link TTS_IDLE_LEAVE_MS} of idle; music leaves as
 * soon as its queue is empty.
 */
export default class VoiceSessionService {
	readonly kazagumo: Kazagumo;
	private readonly deps: VoiceSessionDeps;
	private readonly ttsSessions = new Map<string, TtsSession>();
	private readonly ttsIdleTimers = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();

	constructor(
		client: Client,
		nodes: KazagumoNodes,
		deps: Partial<VoiceSessionDeps> = {},
	) {
		this.deps = {
			createKazagumo: defaultCreateKazagumo,
			joinVoiceChannel,
			createAudioPlayer,
			createAudioResource,
			entersState,
			getVoiceConnection,
			ttsIdleLeaveMs: TTS_IDLE_LEAVE_MS,
			...deps,
		};
		this.kazagumo = this.deps.createKazagumo(client, nodes);

		// Music leaves as soon as its queue runs out; only TTS uses an idle timer.
		this.kazagumo.on("playerEmpty", (player) => {
			this.leave(player.guildId).catch((error) =>
				console.error(
					`Failed to leave voice in guild ${player.guildId}`,
					error,
				),
			);
		});

		// Lavalink events
		// Dervied from Kazagumo readme
		this.kazagumo.shoukaku.on("ready", (name) =>
			console.log(`Lavalink ${name}: Ready!`),
		);
		this.kazagumo.shoukaku.on("error", (name, error) =>
			console.error(`Lavalink ${name}: Error Caught,`, error),
		);
		this.kazagumo.shoukaku.on("close", (name, code, reason) =>
			console.warn(
				`Lavalink ${name}: Closed, Code ${code}, Reason ${reason || "No reason"}`,
			),
		);
		this.kazagumo.shoukaku.on("debug", (name, info) =>
			console.debug(`Lavalink ${name}: Debug,`, info),
		);
		this.kazagumo.shoukaku.on("disconnect", (name) => {
			const players = [...this.kazagumo.shoukaku.players.values()].filter(
				(p) => p.node.name === name,
			);
			players.forEach(async (player) => {
				this.kazagumo.destroyPlayer(player.guildId);
				await player.destroy();
			});
			console.warn(`Lavalink ${name}: Destroyed`);
		});
	}

	// --- Ownership -----------------------------------------------------------

	getOwner(guildId: string): VoiceOwner {
		if (this.kazagumo.getPlayer(guildId)) return "music";
		if (this.ttsSessions.has(guildId)) return "tts";
		return "none";
	}

	isMusicActive(guildId: string): boolean {
		return this.getOwner(guildId) === "music";
	}

	/** The channel the bot is connected to for the guild's current owner, if any. */
	getVoiceChannelId(guildId: string): string | null {
		const player = this.kazagumo.getPlayer(guildId);
		if (player) return player.voiceId ?? null;
		return (
			this.ttsSessions.get(guildId)?.connection.joinConfig.channelId ?? null
		);
	}

	// --- Music ---------------------------------------------------------------

	getMusicPlayer(guildId: string): KazagumoPlayer | undefined {
		return this.kazagumo.getPlayer(guildId);
	}

	/** Releases any TTS session in the guild, then gets or creates the music player. */
	async startMusic(options: {
		guildId: string;
		textId: string;
		voiceId: string;
	}): Promise<KazagumoPlayer> {
		const { guildId, textId, voiceId } = options;
		this.releaseTts(guildId);
		return this.kazagumo.createPlayer({
			guildId,
			textId,
			voiceId,
			deaf: true,
		});
	}

	// --- TTS -----------------------------------------------------------------

	async playTts(options: {
		guildId: string;
		channelId: string;
		adapterCreator: DiscordGatewayAdapterCreator;
		oggPath: string;
		durationSeconds: number;
		onPlaying?: () => Promise<void>;
	}): Promise<void> {
		const {
			guildId,
			channelId,
			adapterCreator,
			oggPath,
			durationSeconds,
			onPlaying,
		} = options;

		if (this.isMusicActive(guildId)) {
			throw new VoiceBusyError();
		}

		this.clearTtsIdleLeave(guildId);
		this.ttsSessions.get(guildId)?.player.stop(true);

		const connection = this.deps.joinVoiceChannel({
			channelId,
			guildId,
			adapterCreator,
		});
		const player = this.deps.createAudioPlayer();
		this.ttsSessions.set(guildId, { player, connection });

		const rejectOnError = new Promise<never>((_resolve, reject) => {
			player.once("error", reject);
		});
		// Avoid an unhandled rejection if the race settles before an error fires.
		rejectOnError.catch(() => undefined);

		try {
			await this.deps.entersState(
				connection,
				VoiceConnectionStatus.Ready,
				15_000,
			);
			if (!connection.subscribe(player)) {
				throw new Error("Could not subscribe audio player to voice connection");
			}
			player.play(
				this.deps.createAudioResource(oggPath, {
					inputType: StreamType.OggOpus,
				}),
			);
			await Promise.race([
				this.deps.entersState(player, AudioPlayerStatus.Playing, 15_000),
				rejectOnError,
			]);
			await onPlaying?.();
			await Promise.race([
				this.deps.entersState(
					player,
					AudioPlayerStatus.Idle,
					Math.ceil((durationSeconds + 10) * 1_000),
				),
				rejectOnError,
			]);

			// Superseded by a newer TTS request or released (music, leave).
			if (this.ttsSessions.get(guildId)?.player !== player) {
				return;
			}
			this.scheduleTtsIdleLeave(guildId);
		} catch (error) {
			if (this.ttsSessions.get(guildId)?.player === player) {
				this.clearTtsIdleLeave(guildId);
				this.ttsSessions.delete(guildId);
				player.stop(true);
				connection.destroy();
			}
			throw error;
		}
	}

	// --- Shared --------------------------------------------------------------

	/** Tears down whatever owns the guild's voice connection and clears timers. */
	async leave(guildId: string): Promise<void> {
		this.clearTtsIdleLeave(guildId);
		const player = this.kazagumo.getPlayer(guildId);
		if (player) {
			await player.destroy();
			return;
		}
		this.releaseTts(guildId);
	}

	/** Leaves every guild; used on shutdown. */
	async destroy(): Promise<void> {
		const guildIds = new Set<string>([
			...this.ttsSessions.keys(),
			...this.kazagumo.players.keys(),
			...this.ttsIdleTimers.keys(),
		]);
		await Promise.allSettled([...guildIds].map((id) => this.leave(id)));
	}

	private releaseTts(guildId: string): void {
		this.clearTtsIdleLeave(guildId);
		const session = this.ttsSessions.get(guildId);
		if (session) {
			session.player.stop(true);
			this.ttsSessions.delete(guildId);
		}
		this.deps.getVoiceConnection(guildId)?.destroy();
	}

	private scheduleTtsIdleLeave(guildId: string): void {
		this.clearTtsIdleLeave(guildId);
		this.ttsIdleTimers.set(
			guildId,
			setTimeout(() => {
				this.ttsIdleTimers.delete(guildId);
				this.leave(guildId).catch((error) =>
					console.error(`Failed to leave voice in guild ${guildId}`, error),
				);
			}, this.deps.ttsIdleLeaveMs),
		);
	}

	private clearTtsIdleLeave(guildId: string): void {
		const timer = this.ttsIdleTimers.get(guildId);
		if (timer) {
			clearTimeout(timer);
			this.ttsIdleTimers.delete(guildId);
		}
	}
}
