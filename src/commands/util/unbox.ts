import {
	ActionRowBuilder,
	type AutocompleteInteraction,
	ButtonBuilder,
	ButtonStyle,
	bold,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	escapeMarkdown,
	MessageFlags,
	SlashCommandBuilder,
	TimestampStyles,
	time,
} from "discord.js";
import { sendLongMessage } from "../../helpers/sendLongMessage";
import {
	createInGameInspectUrl,
	formatCurrency,
	formatRolledSkinsSummary,
	getRarityColor,
	isUnboxCatalogAvailable,
	listCaseNames,
	RARITY_ORDER,
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
		if (!(await isUnboxCatalogAvailable())) {
			await interaction.reply({
				content:
					"CS skins catalog unavailable (assets/skins.json missing or invalid).",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply();

		const selectedCase = interaction.options.getString("case");
		const result = await runUnboxSimulation(selectedCase);
		const balance = await interaction.client.bot.balances.applyProfit(
			interaction.user.id,
			result.profitCents,
			Math.round(result.totalSpent * 100),
			Math.round(result.totalGained * 100),
		);

		const floatDisplay =
			result.finalSkin.floatValue === null
				? "N/A"
				: result.finalSkin.floatValue.toFixed(6);
		const embed = new EmbedBuilder()
			.setColor(getRarityColor(result.finalSkin.rarity))
			.setTitle(escapeMarkdown(result.displayName))
			.setDescription(`Unboxing ${escapeMarkdown(result.caseName)}`)
			.setThumbnail(result.finalSkin.imageUrl)
			.addFields(
				{
					name: "Exterior",
					value: escapeMarkdown(result.finalSkin.wear),
					inline: true,
				},
				{
					name: "Price",
					value: formatCurrency(result.finalSkin.price),
					inline: true,
				},
				{ name: "Float", value: floatDisplay, inline: true },
				{ name: "Total rolls", value: result.rolls.toString(), inline: true },
				...RARITY_ORDER.map((rarity) => ({
					name: `${rarity}s`,
					value: result.countsByRarity[rarity].toString(),
					inline: true,
				})),
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
			)
			.setFooter({
				text: `Last Updated: ${time(result.scrapedAt, TimestampStyles.LongDate)}`,
			});

		const buttonCustomId = `unbox:view:${interaction.id}`;
		const inspectUrl = createInGameInspectUrl(
			result.finalSkin,
			result.paintSeed,
		);
		const inspectButton = inspectUrl
			? new ButtonBuilder()
					.setURL(inspectUrl)
					.setLabel("View in-game")
					.setStyle(ButtonStyle.Link)
			: null;
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(buttonCustomId)
				.setLabel("See all skins opened")
				.setStyle(ButtonStyle.Secondary),
		);
		if (inspectButton) {
			row.addComponents(inspectButton);
		}
		const remainingComponents = inspectButton
			? [new ActionRowBuilder<ButtonBuilder>().addComponents(inspectButton)]
			: [];

		const content =
			`Your new balance: ${bold(formatCurrency(balance.balanceCents / 100))}\n` +
			`Most gained in one run: ${bold(formatCurrency(balance.mostGainedCents / 100))}\n` +
			`Most lost in one run: ${bold(formatCurrency(balance.mostLostCents / 100))}`;
		const settledReply = {
			content,
			embeds: [embed],
			components: remainingComponents,
		};

		const reply = await interaction.editReply({
			content,
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

			await confirmation.update(settledReply);
			if (confirmation.channel?.isSendable()) {
				await sendLongMessage(
					confirmation.channel,
					formatRolledSkinsSummary(result.rolledSkins),
					false,
				);
			}
		} catch {
			await interaction.editReply(settledReply);
		}
	}

	async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
		if (!(await isUnboxCatalogAvailable())) {
			await interaction.respond([]);
			return;
		}

		const focusedValue = interaction.options.getFocused().toLowerCase();
		const caseNames = await listCaseNames();
		const filtered = caseNames
			.filter((caseName) => caseName.toLowerCase().includes(focusedValue))
			.slice(0, 25)
			.map((caseName) => ({ name: caseName, value: caseName }));

		await interaction.respond(filtered);
	}
}
