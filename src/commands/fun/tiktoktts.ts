import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	entersState,
	joinVoiceChannel,
	StreamType,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import {
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
	MessageFlags,
	Routes,
	SlashCommandBuilder,
} from "discord.js";
import ffmpegPath from "ffmpeg-static";
import { config, createAudioFromText } from "tiktok-tts";
import type Command from "../../models/Command";

type OutputMode = "voice" | "attachment";
type TikTokVoice = Readonly<{
	name: string;
	language: string;
	apiValue: string;
}>;

export const TIKTOK_VOICES: readonly TikTokVoice[] = [
	{ name: "Game On", language: "English", apiValue: "en_male_jomboy" },
	{ name: "Jessie", language: "English", apiValue: "en_us_002" },
	{ name: "Warm", language: "English", apiValue: "es_mx_002" },
	{ name: "Wacky", language: "English", apiValue: "en_male_funny" },
	{ name: "Scream", language: "English", apiValue: "en_us_ghostface" },
	{ name: "Empathetic", language: "English", apiValue: "en_female_samc" },
	{ name: "Serious", language: "English", apiValue: "en_male_cody" },
	{ name: "Beauty Guru", language: "English", apiValue: "en_female_makeup" },
	{ name: "Bestie", language: "English", apiValue: "en_female_richgirl" },
	{ name: "Trickster", language: "English", apiValue: "en_male_grinch" },
	{ name: "Joey", language: "English", apiValue: "en_us_006" },
	{ name: "Story Teller", language: "English", apiValue: "en_male_narration" },
	{ name: "Mr. GoodGuy", language: "English", apiValue: "en_male_deadpool" },
	{ name: "Narrator", language: "English", apiValue: "en_uk_001" },
	{ name: "Male English UK", language: "English", apiValue: "en_uk_003" },
	{ name: "Metro", language: "English", apiValue: "en_au_001" },
	{ name: "Alfred", language: "English", apiValue: "en_male_jarvis" },
	{ name: "ashmagic", language: "English", apiValue: "en_male_ashmagic" },
	{ name: "olantekkers", language: "English", apiValue: "en_male_olantekkers" },
	{ name: "Lord Cringe", language: "English", apiValue: "en_male_ukneighbor" },
	{ name: "Mr. Meticulous", language: "English", apiValue: "en_male_ukbutler" },
	{ name: "Debutante", language: "English", apiValue: "en_female_shenna" },
	{ name: "Varsity", language: "English", apiValue: "en_female_pansino" },
	{ name: "Marty", language: "English", apiValue: "en_male_trevor" },
	{
		name: "Pop Lullaby",
		language: "English",
		apiValue: "en_female_f08_twinkle",
	},
	{
		name: "Classic Electric",
		language: "English",
		apiValue: "en_male_m03_classical",
	},
	{ name: "Bae", language: "English", apiValue: "en_female_betty" },
	{ name: "Cupid", language: "English", apiValue: "en_male_cupid" },
	{ name: "Granny", language: "English", apiValue: "en_female_grandma" },
	{
		name: "Cozy",
		language: "English",
		apiValue: "en_male_m2_xhxs_m03_christmas",
	},
	{ name: "Author", language: "English", apiValue: "en_male_santa_narration" },
	{
		name: "Caroler",
		language: "English",
		apiValue: "en_male_sing_deep_jingle",
	},
	{ name: "Santa", language: "English", apiValue: "en_male_santa_effect" },
	{
		name: "NYE 2023",
		language: "English",
		apiValue: "en_female_ht_f08_newyear",
	},
	{ name: "Magician", language: "English", apiValue: "en_male_wizard" },
	{
		name: "Opera",
		language: "English",
		apiValue: "en_female_ht_f08_halloween",
	},
	{
		name: "Euphoric",
		language: "English",
		apiValue: "en_female_ht_f08_glorious",
	},
	{
		name: "Hypetrain",
		language: "English",
		apiValue: "en_male_sing_funny_it_goes_up",
	},
	{
		name: "Melodrama",
		language: "English",
		apiValue: "en_female_ht_f08_wonderful_world",
	},
	{
		name: "Quirky Time",
		language: "English",
		apiValue: "en_male_m2_xhxs_m03_silly",
	},
	{ name: "Peaceful", language: "English", apiValue: "en_female_emotional" },
	{
		name: "Toon Beat",
		language: "English",
		apiValue: "en_male_m03_sunshine_soon",
	},
	{
		name: "Open Mic",
		language: "English",
		apiValue: "en_female_f08_warmy_breeze",
	},
	{ name: "Jingle", language: "English", apiValue: "en_male_m03_lobby" },
	{
		name: "Thanksgiving",
		language: "English",
		apiValue: "en_male_sing_funny_thanksgiving",
	},
	{
		name: "Cottagecore",
		language: "English",
		apiValue: "en_female_f08_salut_damour",
	},
	{ name: "Professor", language: "English", apiValue: "en_us_007" },
	{ name: "Scientist", language: "English", apiValue: "en_us_009" },
	{ name: "Confidence", language: "English", apiValue: "en_us_010" },
	{ name: "Smooth", language: "English", apiValue: "en_au_002" },
	{ name: "Ghost Face", language: "Disney", apiValue: "en_us_ghostface" },
	{ name: "Chewbacca", language: "Disney", apiValue: "en_us_chewbacca" },
	{ name: "C3PO", language: "Disney", apiValue: "en_us_c3po" },
	{ name: "Stitch", language: "Disney", apiValue: "en_us_stitch" },
	{ name: "Stormtrooper", language: "Disney", apiValue: "en_us_stormtrooper" },
	{ name: "Rocket", language: "Disney", apiValue: "en_us_rocket" },
	{
		name: "Madame Leota",
		language: "Disney",
		apiValue: "en_female_madam_leota",
	},
	{ name: "Ghost Host", language: "Disney", apiValue: "en_male_ghosthost" },
	{ name: "Pirate", language: "Disney", apiValue: "en_male_pirate" },
	{ name: "French - Male 1", language: "French", apiValue: "fr_001" },
	{ name: "French - Male 2", language: "French", apiValue: "fr_002" },
	{ name: "Spanish (Spain) - Male", language: "Spanish", apiValue: "es_002" },
	{ name: "Spanish MX - Male", language: "Spanish", apiValue: "es_mx_002" },
	{
		name: "Portuguese BR - Female 1",
		language: "Portuguese",
		apiValue: "br_001",
	},
	{
		name: "Portuguese BR - Female 2",
		language: "Portuguese",
		apiValue: "br_003",
	},
	{
		name: "Portuguese BR - Female 3",
		language: "Portuguese",
		apiValue: "br_004",
	},
	{ name: "Portuguese BR - Male", language: "Portuguese", apiValue: "br_005" },
	{
		name: "Ivete Sangalo",
		language: "Portuguese",
		apiValue: "bp_female_ivete",
	},
	{ name: "Ludmilla", language: "Portuguese", apiValue: "bp_female_ludmilla" },
	{ name: "Lhays Macedo", language: "Portuguese", apiValue: "pt_female_lhays" },
	{ name: "Laizza", language: "Portuguese", apiValue: "pt_female_laizza" },
	{ name: "Galvão Bueno", language: "Portuguese", apiValue: "pt_male_bueno" },
	{ name: "German - Female", language: "German", apiValue: "de_001" },
	{ name: "German - Male", language: "German", apiValue: "de_002" },
	{ name: "Indonesian - Female", language: "Indonesian", apiValue: "id_001" },
	{ name: "Japanese - Female 1", language: "Japanese", apiValue: "jp_001" },
	{ name: "Japanese - Female 2", language: "Japanese", apiValue: "jp_003" },
	{ name: "Japanese - Female 3", language: "Japanese", apiValue: "jp_005" },
	{ name: "Japanese - Male", language: "Japanese", apiValue: "jp_006" },
	{ name: "りーさ", language: "Japanese", apiValue: "jp_female_fujicochan" },
	{ name: "世羅鈴", language: "Japanese", apiValue: "jp_female_hasegawariona" },
	{
		name: "Morio’s Kitchen",
		language: "Japanese",
		apiValue: "jp_male_keiichinakano",
	},
	{ name: "夏絵ココ", language: "Japanese", apiValue: "jp_female_oomaeaika" },
	{
		name: "低音ボイス",
		language: "Japanese",
		apiValue: "jp_male_yujinchigusa",
	},
	{ name: "四郎", language: "Japanese", apiValue: "jp_female_shirou" },
	{ name: "玉川寿紀", language: "Japanese", apiValue: "jp_male_tamawakazuki" },
	{ name: "庄司果織", language: "Japanese", apiValue: "jp_female_kaorishoji" },
	{ name: "八木沙季", language: "Japanese", apiValue: "jp_female_yagishaki" },
	{ name: "ヒカキン", language: "Japanese", apiValue: "jp_male_hikakin" },
	{ name: "丸山礼", language: "Japanese", apiValue: "jp_female_rei" },
	{ name: "修一朗", language: "Japanese", apiValue: "jp_male_shuichiro" },
	{
		name: "マツダ家の日常",
		language: "Japanese",
		apiValue: "jp_male_matsudake",
	},
	{
		name: "まちこりーた",
		language: "Japanese",
		apiValue: "jp_female_machikoriiita",
	},
	{ name: "モジャオ", language: "Japanese", apiValue: "jp_male_matsuo" },
	{ name: "モリスケ", language: "Japanese", apiValue: "jp_male_osada" },
	{ name: "Korean - Male 1", language: "Korean", apiValue: "kr_002" },
	{ name: "Korean - Female", language: "Korean", apiValue: "kr_003" },
	{ name: "Korean - Male 2", language: "Korean", apiValue: "kr_004" },
	{ name: "Female", language: "Vietnamese", apiValue: "BV074_streaming" },
	{ name: "Male", language: "Vietnamese", apiValue: "BV075_streaming" },
	{ name: "Alto", language: "Other", apiValue: "en_female_f08_salut_damour" },
	{ name: "Tenor", language: "Other", apiValue: "en_male_m03_lobby" },
	{
		name: "Sunshine Soon",
		language: "Other",
		apiValue: "en_male_m03_sunshine_soon",
	},
	{
		name: "Warmy Breeze",
		language: "Other",
		apiValue: "en_female_f08_warmy_breeze",
	},
	{
		name: "Glorious",
		language: "Other",
		apiValue: "en_female_ht_f08_glorious",
	},
	{
		name: "It Goes Up",
		language: "Other",
		apiValue: "en_male_sing_funny_it_goes_up",
	},
	{
		name: "Chipmunk",
		language: "Other",
		apiValue: "en_male_m2_xhxs_m03_silly",
	},
	{
		name: "Dramatic",
		language: "Other",
		apiValue: "en_female_ht_f08_wonderful_world",
	},
];

export function resolveOutputMode(
	requestedMode: OutputMode | null,
	canPlayInVoice: boolean,
): OutputMode {
	return canPlayInVoice ? (requestedMode ?? "voice") : "attachment";
}

function parseDuration(progress: string): number {
	const values = [...progress.matchAll(/^out_time_us=(\d+)$/gm)];
	const durationSeconds = Number(values.at(-1)?.[1]) / 1_000_000;
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		throw new Error("FFmpeg did not report a positive duration");
	}
	return durationSeconds;
}

async function transcodeAudio(
	mp3Path: string,
	oggPath: string,
): Promise<number> {
	if (!ffmpegPath) {
		throw new Error("ffmpeg-static is unavailable on this platform");
	}

	const process = Bun.spawn(
		[
			ffmpegPath,
			"-hide_banner",
			"-loglevel",
			"error",
			"-y",
			"-i",
			mp3Path,
			"-vn",
			"-ac",
			"1",
			"-ar",
			"48000",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-f",
			"ogg",
			"-progress",
			"pipe:1",
			"-nostats",
			oggPath,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, progress, stderr] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`FFmpeg exited with code ${exitCode}: ${stderr}`);
	}
	return parseDuration(progress);
}

function buildWaveform(durationSeconds: number): string {
	const length = Math.min(256, Math.max(1, Math.ceil(durationSeconds * 10)));
	return Buffer.alloc(length, 128).toString("base64");
}

async function postVoiceMessage(
	interaction: ChatInputCommandInteraction,
	oggPath: string,
	durationSeconds: number,
): Promise<void> {
	await interaction.client.rest.post(
		Routes.channelMessages(interaction.channelId),
		{
			files: [
				{
					data: new Uint8Array(await Bun.file(oggPath).arrayBuffer()),
					name: "tiktoktts.ogg",
					contentType: "audio/ogg",
				},
			],
			body: {
				flags: MessageFlags.IsVoiceMessage,
				attachments: [
					{
						id: 0,
						filename: "tiktoktts.ogg",
						duration_secs: durationSeconds,
						waveform: buildWaveform(durationSeconds),
					},
				],
			},
		},
	);
}

async function playInVoice(
	interaction: ChatInputCommandInteraction<"cached">,
	voiceChannelId: string,
	oggPath: string,
	durationSeconds: number,
): Promise<void> {
	const connection = joinVoiceChannel({
		channelId: voiceChannelId,
		guildId: interaction.guildId,
		adapterCreator: interaction.guild.voiceAdapterCreator,
	});
	const player = createAudioPlayer();
	const rejectOnError = new Promise<never>((_resolve, reject) => {
		player.once("error", reject);
	});

	try {
		await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
		if (!connection.subscribe(player)) {
			throw new Error("Could not subscribe audio player to voice connection");
		}
		player.play(
			createAudioResource(oggPath, {
				inputType: StreamType.OggOpus,
			}),
		);
		await Promise.race([
			entersState(player, AudioPlayerStatus.Playing, 15_000),
			rejectOnError,
		]);
		await interaction.editReply("Playing TikTok TTS in your voice channel.");
		await Promise.race([
			entersState(
				player,
				AudioPlayerStatus.Idle,
				Math.ceil((durationSeconds + 10) * 1_000),
			),
			rejectOnError,
		]);
	} finally {
		player.stop(true);
		connection.destroy();
	}
}

export default class TiktokTts implements Command {
	data = new SlashCommandBuilder()
		.setName("tiktoktts")
		.setDescription("Creates TikTok text-to-speech audio")
		.addStringOption((option) =>
			option
				.setName("message")
				.setDescription("The text to speak")
				.setRequired(true),
		)
		.addStringOption((option) =>
			option
				.setName("voice")
				.setDescription("The TikTok voice to use")
				.setRequired(true)
				.setAutocomplete(true),
		)
		.addStringOption((option) =>
			option
				.setName("mode")
				.setDescription("Where to play the audio")
				.addChoices(
					{ name: "Voice", value: "voice" },
					{ name: "Attachment", value: "attachment" },
				),
		);

	async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
		const focused = interaction.options.getFocused().toLowerCase();
		const choices = TIKTOK_VOICES.filter(
			(voice) =>
				voice.name.toLowerCase().includes(focused) ||
				voice.language.toLowerCase().includes(focused),
		).slice(0, 25);
		await interaction.respond(
			choices.map((voice) => ({
				name: `${voice.name} (${voice.language})`,
				value: voice.name,
			})),
		);
	}

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const message = interaction.options.getString("message");
		if (message === null) {
			await interaction.reply({
				content: "You must provide a message.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const voiceName = interaction.options.getString("voice");
		const voice = TIKTOK_VOICES.find(({ name }) => name === voiceName);
		if (!voice) {
			await interaction.reply({
				content: "Choose a voice from the autocomplete list.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const requestedMode = interaction.options.getString("mode");
		if (
			requestedMode !== null &&
			requestedMode !== "voice" &&
			requestedMode !== "attachment"
		) {
			await interaction.reply({
				content: "Choose a valid output mode.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const sessionId = interaction.client.bot.config.get("TIKTOK_SESSION_ID");
		if (!sessionId?.trim()) {
			await interaction.reply({
				content: "TikTok TTS is not configured.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const voiceChannel = interaction.inCachedGuild()
			? interaction.member.voice.channel
			: null;
		const canPlayInVoice =
			voiceChannel?.joinable === true &&
			"speakable" in voiceChannel &&
			voiceChannel.speakable === true;
		const outputMode = resolveOutputMode(requestedMode, canPlayInVoice);

		if (
			outputMode === "voice" &&
			interaction.inCachedGuild() &&
			interaction.client.bot.music.getPlayer(interaction.guildId)
		) {
			await interaction.reply({
				content:
					"TikTok TTS cannot play while music is active. Choose attachment mode instead.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		let tempDir: string | undefined;
		try {
			tempDir = await mkdtemp(path.join(tmpdir(), "tiktoktts-"));
			const audioBasePath = path.join(tempDir, "speech");
			const oggPath = path.join(tempDir, "speech.ogg");
			config(sessionId);
			await createAudioFromText(message, audioBasePath, voice.apiValue);
			const durationSeconds = await transcodeAudio(
				`${audioBasePath}.mp3`,
				oggPath,
			);

			if (outputMode === "attachment") {
				await postVoiceMessage(interaction, oggPath, durationSeconds);
				await interaction.editReply("Sent your TikTok TTS voice message.");
			} else {
				if (!voiceChannel || !interaction.inCachedGuild()) {
					throw new Error(
						"Resolved voice output without a cached voice channel",
					);
				}
				await playInVoice(
					interaction,
					voiceChannel.id,
					oggPath,
					durationSeconds,
				);
			}
		} catch (error) {
			console.error("Failed to create TikTok TTS audio", error);
			await interaction.editReply("Failed to create TikTok TTS audio.");
		} finally {
			if (tempDir) {
				await rm(tempDir, { recursive: true, force: true });
			}
		}
	}
}
