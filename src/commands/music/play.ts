import {
	GuildMember,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";
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
		if (!interaction.guildId) {
			await interaction.reply({
				content: "This command can only be used in a guild",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!(interaction.member instanceof GuildMember)) {
			await interaction.reply({
				content: "This command can only be used by a member",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!interaction.member?.voice.channelId) {
			await interaction.reply({
				content: "You must be in a voice channel to use this command",
				flags: MessageFlags.Ephemeral,
			});
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
			guildId: interaction.guildId,
			textId: interaction.channelId,
			voiceId: interaction.member.voice.channelId,
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
