import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import type Command from "../../models/Command";

export default class Echo implements Command {
	data = new SlashCommandBuilder()
		.setName("echo")
		.setDescription("Send a message as the bot")
		.addStringOption((option) =>
			option.setName("msg").setDescription("Message to send").setRequired(true),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		if (!interaction.client.bot.permissions.isAdminUser(interaction.user.id)) {
			await interaction.reply({
				content: "You don't have permission to use this command.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const msg = interaction.options.getString("msg", true);

		if (!interaction.channel?.isSendable()) {
			await interaction.reply({
				content: "Failed to send the message: this channel is not sendable.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			await interaction.channel.send(msg);
		} catch (error) {
			console.error("Failed to send echo message:", error);
			await interaction.reply({
				content:
					"Failed to send the message: an error occurred, details in console.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.reply({
			content: "Message sent.",
			flags: MessageFlags.Ephemeral,
		});
	}
}
