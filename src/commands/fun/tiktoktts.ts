import {
	type AutocompleteInteraction,
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import {
	createTikTokSpeechOgg,
	playOggInVoiceChannel,
	postVoiceMessage,
	resolveOutputMode,
	TIKTOK_VOICES,
} from "../../helpers/tiktoktts";
import type Command from "../../models/Command";

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
		let cleanup: (() => Promise<void>) | undefined;
		try {
			const speech = await createTikTokSpeechOgg(
				sessionId,
				message,
				voice.apiValue,
				interaction.client.bot.metrics,
			);
			cleanup = speech.cleanup;

			if (outputMode === "attachment") {
				await postVoiceMessage({
					rest: interaction.client.rest,
					channelId: interaction.channelId,
					oggPath: speech.oggPath,
					durationSeconds: speech.durationSeconds,
				});
				await interaction.editReply("Sent your TikTok TTS voice message.");
			} else {
				if (!voiceChannel || !interaction.inCachedGuild()) {
					throw new Error(
						"Resolved voice output without a cached voice channel",
					);
				}
				await playOggInVoiceChannel({
					channelId: voiceChannel.id,
					guildId: interaction.guildId,
					adapterCreator: interaction.guild.voiceAdapterCreator,
					oggPath: speech.oggPath,
					durationSeconds: speech.durationSeconds,
					onPlaying: async () => {
						await interaction.editReply(
							"Playing TikTok TTS in your voice channel.",
						);
					},
				});
			}
		} catch (error) {
			console.error("Failed to create TikTok TTS audio", error);
			await interaction.editReply("Failed to create TikTok TTS audio.");
		} finally {
			await cleanup?.();
		}
	}
}
