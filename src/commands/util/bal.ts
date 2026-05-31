import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { formatCurrency } from "../../helpers/unbox";
import type Command from "../../models/Command";
import type { UserBalance } from "../../repositories/UserBalanceRepository";

const ZERO_BALANCE: UserBalance = {
	userId: "",
	balanceCents: 0,
	mostGainedCents: 0,
	mostLostCents: 0,
};

export default class Bal implements Command {
	data = new SlashCommandBuilder()
		.setName("bal")
		.setDescription("Check an unboxing balance")
		.addUserOption((option) =>
			option
				.setName("user")
				.setDescription("The user whose balance to check")
				.setRequired(false),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const targetUser = interaction.options.getUser("user") ?? interaction.user;
		const balance =
			(await interaction.client.bot.balances.getByUserId(targetUser.id)) ??
			ZERO_BALANCE;

		const label =
			targetUser.id === interaction.user.id
				? "Your balance"
				: `${targetUser.toString()}'s balance`;

		await interaction.reply({
			content: `${label}: ${formatCurrency(balance.balanceCents / 100)}`,
			flags: MessageFlags.Ephemeral,
		});
	}
}
