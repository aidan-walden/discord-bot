import {
	type ChatInputCommandInteraction,
	escapeMarkdown,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { requireAdminUser } from "../../helpers/permissions";
import type Command from "../../models/Command";

export default class Echo implements Command {
	data = new SlashCommandBuilder()
		.setName("echo")
		.setDescription("Send a message as the bot")
		.addStringOption((option) =>
			option.setName("msg").setDescription("Message to send").setRequired(true),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		if (!(await requireAdminUser(interaction))) {
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
			await interaction.channel.send({
				content: escapeMarkdown(msg),
				allowedMentions: { parse: [] },
			});
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
