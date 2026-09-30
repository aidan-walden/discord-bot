import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";

export async function requireAdminUser(
	interaction: ChatInputCommandInteraction,
): Promise<boolean> {
	if (interaction.client.bot.permissions.isAdminUser(interaction.user.id)) {
		return true;
	}

	await interaction.reply({
		content: "You don't have permission to use this command.",
		flags: MessageFlags.Ephemeral,
	});
	return false;
}
