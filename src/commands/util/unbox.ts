import {
	ActionRowBuilder,
	type AutocompleteInteraction,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	SlashCommandBuilder,
} from "discord.js";
import { sendLongMessage } from "../../helpers/sendLongMessage";
import {
	formatCurrency,
	formatRolledSkinsSummary,
	getRarityColor,
	listCaseNames,
	runUnboxSimulation,
} from "../../helpers/unbox";
import type Command from "../../models/Command";

export default class Unbox implements Command {
	data = new SlashCommandBuilder()
		.setName("unbox")
		.setDescription("Simulate unboxing a CS case")
		.addStringOption((option) =>
			option
				.setName("case")
				.setDescription("The case to unbox")
				.setRequired(false)
				.setAutocomplete(true),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		await interaction.deferReply();

		const selectedCase = interaction.options.getString("case");
		const result = await runUnboxSimulation(selectedCase);
		const balance = await interaction.client.bot.balances.applyProfit(
			interaction.user.id,
			result.profitCents,
		);

		const floatDisplay =
			result.finalSkin.floatValue === null
				? "N/A"
				: result.finalSkin.floatValue.toFixed(6);
		const embed = new EmbedBuilder()
			.setColor(getRarityColor(result.finalSkin.rarity))
			.setTitle(result.displayName)
			.setDescription(`Unboxing ${result.caseName}`)
			.setThumbnail(result.finalSkin.imageUrl)
			.addFields(
				{ name: "Exterior", value: result.finalSkin.wear, inline: true },
				{
					name: "Price",
					value: formatCurrency(result.finalSkin.price),
					inline: true,
				},
				{ name: "Float", value: floatDisplay, inline: true },
				{ name: "Total rolls", value: result.rolls.toString(), inline: true },
				{
					name: "Blues",
					value: result.countsByRarity.Blue.toString(),
					inline: true,
				},
				{
					name: "Purples",
					value: result.countsByRarity.Purple.toString(),
					inline: true,
				},
				{
					name: "Pinks",
					value: result.countsByRarity.Pink.toString(),
					inline: true,
				},
				{
					name: "Reds",
					value: result.countsByRarity.Red.toString(),
					inline: true,
				},
				{
					name: "Golds",
					value: result.countsByRarity.Gold.toString(),
					inline: true,
				},
				{
					name: "Total spent on keys",
					value: formatCurrency(result.spentKeys),
					inline: true,
				},
				{
					name: "Total spent on cases",
					value: formatCurrency(result.spentCases),
					inline: true,
				},
				{
					name: "Total spent",
					value: formatCurrency(result.totalSpent),
					inline: true,
				},
				{
					name: "Profit",
					value: formatCurrency(result.profit),
					inline: true,
				},
			);

		const buttonCustomId = `unbox:view:${interaction.id}`;
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(buttonCustomId)
				.setLabel("See all skins opened")
				.setStyle(ButtonStyle.Secondary),
		);

		const reply = await interaction.editReply({
			content:
				`Your new balance: **${formatCurrency(balance.balanceCents / 100)}**\n` +
				`Most gained in one run: **${formatCurrency(balance.mostGainedCents / 100)}**\n` +
				`Most lost in one run: **${formatCurrency(balance.mostLostCents / 100)}**`,
			embeds: [embed],
			components: [row],
		});

		try {
			const confirmation = await reply.awaitMessageComponent({
				filter: (componentInteraction) =>
					componentInteraction.customId === buttonCustomId &&
					componentInteraction.user.id === interaction.user.id,
				time: 60_000,
			});

			await confirmation.update({
				content:
					`Your new balance: **${formatCurrency(balance.balanceCents / 100)}**\n` +
					`Most gained in one run: **${formatCurrency(balance.mostGainedCents / 100)}**\n` +
					`Most lost in one run: **${formatCurrency(balance.mostLostCents / 100)}**`,
				embeds: [embed],
				components: [],
			});
			if (confirmation.channel?.isSendable()) {
				await sendLongMessage(
					confirmation.channel,
					formatRolledSkinsSummary(result.rolledSkins),
				);
			}
		} catch {
			await interaction.editReply({
				content:
					`Your new balance: **${formatCurrency(balance.balanceCents / 100)}**\n` +
					`Most gained in one run: **${formatCurrency(balance.mostGainedCents / 100)}**\n` +
					`Most lost in one run: **${formatCurrency(balance.mostLostCents / 100)}**`,
				embeds: [embed],
				components: [],
			});
		}
	}

	async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
		const focusedValue = interaction.options.getFocused().toLowerCase();
		const caseNames = await listCaseNames();
		const filtered = caseNames
			.filter((caseName) => caseName.toLowerCase().includes(focusedValue))
			.slice(0, 25)
			.map((caseName) => ({ name: caseName, value: caseName }));

		await interaction.respond(filtered);
	}
}
