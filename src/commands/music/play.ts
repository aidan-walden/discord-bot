import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Play implements Command {
	data = new SlashCommandBuilder()
		.setName("play")
		.setDescription("Plays a song from YouTube")
		.addStringOption((option) =>
			option
				.setName("query")
				.setDescription("The song to play")
				.setRequired(true),
		);
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
		});
		if (!context || !context.voiceChannelId) {
			return;
		}

		const query = interaction.options.getString("query");
		if (!query) {
			await interaction.reply({
				content: "Please provide a song to play",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const results = await interaction.client.bot.music.search(query, {
			requester: interaction.user,
		});
		if (results.tracks.length === 0) {
			await interaction.reply({
				content: "No song found",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const song = results.tracks[0];
		if (!song) {
			await interaction.reply({
				content: "No song found",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Get or create player
		const player = await interaction.client.bot.music.createPlayer({
			guildId: context.guildId,
			textId: interaction.channelId,
			voiceId: context.voiceChannelId,
			deaf: true,
		});

		if (!player) {
			await interaction.reply({
				content: "Failed to create player",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!player.playing && player.queue.size === 0) {
			await player.play(song);
			await interaction.reply({
				content: `Now playing **${song.title}** by **${song.author}**`,
			});
		} else {
			player.queue.add(song);
			await interaction.reply({
				content: `Added **${song.title}** to the queue`,
			});
		}
	}
}
