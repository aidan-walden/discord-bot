import { type CommandInteraction, MessageFlags } from "discord.js";

export function isAdminUser(
	userId: string,
	adminUserIds: ReadonlySet<string>,
): boolean {
	return adminUserIds.has(userId);
}

export async function requireAdminUser(
	interaction: CommandInteraction,
	adminUserIds: ReadonlySet<string>,
): Promise<boolean> {
	if (isAdminUser(interaction.user.id, adminUserIds)) {
		return true;
	}

	await interaction.reply({
		content: "You don't have permission to use that command.",
		flags: MessageFlags.Ephemeral,
	});
	return false;
}
