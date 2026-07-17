import {
	type ChatInputCommandInteraction,
	escapeMarkdown,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import type Command from "../../models/Command";

export default class Nick implements Command {
	data = new SlashCommandBuilder()
		.setName("nick")
		.setDescription("Change the bot's nickname in this server")
		.addStringOption((option) =>
			option
				.setName("nickname")
				.setDescription("The new nickname")
				.setRequired(true),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		if (!interaction.client.bot.permissions.isAdminUser(interaction.user.id)) {
			await interaction.reply({
				content: "You don't have permission to use this command.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!interaction.inGuild() || !interaction.guild) {
			await interaction.reply({
				content: "You can't use that command here.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const nickname = interaction.options.getString("nickname", true);
		const me = interaction.guild.members.me;
		if (!me) {
			await interaction.reply({
				content: "Couldn't find my member data in this server.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			await me.setNickname(nickname);
		} catch (error) {
			console.error("Failed to set nickname:", error);
			await interaction.reply({
				content: "Failed to change my nickname. Do I have Manage Nicknames?",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.reply({
			content: `Nickname changed to ${escapeMarkdown(nickname)}.`,
			flags: MessageFlags.Ephemeral,
		});
	}
}
