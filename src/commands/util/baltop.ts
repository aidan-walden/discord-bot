import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { formatCurrency } from "../../helpers/unbox";
import type Command from "../../models/Command";

export default class Baltop implements Command {
	data = new SlashCommandBuilder()
		.setName("baltop")
		.setDescription("Top unboxing balances");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const top = await interaction.client.bot.balances.getTop(10);

		if (top.length === 0) {
			await interaction.reply({
				content: "No balances yet.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const embed = new EmbedBuilder().setTitle("Unboxing Leaderboard").addFields(
			top.map((entry, index) => ({
				name: `#${index + 1}`,
				value:
					`<@${entry.userId}> — ` +
					`Balance: ${formatCurrency(entry.balanceCents / 100)} · ` +
					`Spent: ${formatCurrency(entry.totalSpentCents / 100)} · ` +
					`Gained: ${formatCurrency(entry.totalGainedCents / 100)} · ` +
					`Unboxes: ${entry.unboxCount}`,
			})),
		);

		await interaction.reply({ embeds: [embed] });
	}
}
