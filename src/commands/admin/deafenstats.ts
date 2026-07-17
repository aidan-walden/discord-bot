import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	escapeMarkdown,
	GuildMember,
	MessageFlags,
	SlashCommandBuilder,
	userMention,
} from "discord.js";
import type Command from "../../models/Command";

function formatDuration(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${hours}h ${minutes}m ${seconds}s`;
}

export default class DeafenStats implements Command {
	data = new SlashCommandBuilder()
		.setName("deafenstats")
		.setDescription("View deafen tracker data for a member")
		.addUserOption((option) =>
			option
				.setName("member")
				.setDescription("The member to view deafen stats for")
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

		const member = interaction.options.getMember("member");
		if (!interaction.inGuild() || !(member instanceof GuildMember)) {
			await interaction.reply({
				content: "You can't use that command here.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const summary = await interaction.client.bot.deafenSessions.getSummary(
			member.id,
			interaction.guildId,
		);

		if (!summary) {
			await interaction.reply({
				content: `No deafen data recorded for ${userMention(member.id)}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const embed = new EmbedBuilder()
			.setTitle(`Deafen Tracker — ${escapeMarkdown(member.displayName)}`)
			.addFields(
				{
					name: "Total Deafened",
					value: formatDuration(summary.totalDeafenSeconds),
					inline: true,
				},
				{
					name: "Longest Session",
					value: formatDuration(summary.longestDeafenSeconds),
					inline: true,
				},
				{
					name: "Sessions",
					value: `${summary.sessionCount}`,
					inline: true,
				},
			);

		await interaction.reply({
			embeds: [embed],
			flags: MessageFlags.Ephemeral,
		});
	}
}
