import {
	GuildMember,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";
import type Command from "../../models/Command";

export default class Skip implements Command {
	data = new SlashCommandBuilder()
		.setName("skip")
		.setDescription("Skips the current song");
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		if (!interaction.guildId) {
			await interaction.reply({ content: "This command can only be used in a guild", flags: MessageFlags.Ephemeral });
			return;
		}

		if (!(interaction.member instanceof GuildMember)) {
			await interaction.reply({ content: "This command can only be used by a member", flags: MessageFlags.Ephemeral });
			return;
		}

		if (!interaction.member?.voice.channelId) {
			await interaction.reply({ content: "You must be in a voice channel to use this command", flags: MessageFlags.Ephemeral });
			return;
		}


		const player = interaction.client.bot.music.getPlayer(interaction.guildId);
		if (!player) {
			await interaction.reply({ content: "There is nothing playing", flags: MessageFlags.Ephemeral });
			return;
		}

		player.skip();
		await interaction.reply({ content: "Skipped the current song" });
	}
}
