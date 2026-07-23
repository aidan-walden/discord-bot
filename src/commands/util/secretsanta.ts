import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ChatInputCommandInteraction,
	EmbedBuilder,
	inlineCode,
	MessageFlags,
	SlashCommandBuilder,
	userMention,
} from "discord.js";
import { assignSecretSanta } from "../../helpers/secretSantaAssign";
import type Command from "../../models/Command";
import type {
	SecretSantaAssignment,
	SecretSantaDraw,
} from "../../repositories/SecretSantaRepository";

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;

function formatSpendLimit(cents: number | null): string {
	if (cents === null) {
		return "No spend limit set.";
	}
	return `$${(cents / 100).toFixed(2)}`;
}

function formatMentionList(ids: string[]): string {
	if (ids.length === 0) return "None";
	let value = "";
	for (let i = 0; i < ids.length; i++) {
		const next = value
			? `${value}, ${userMention(ids[i] as string)}`
			: userMention(ids[i] as string);
		const remaining = ids.length - i - 1;
		if (`${next}${remaining ? `, and ${remaining} more` : ""}`.length > 1024) {
			return `${value}, and ${ids.length - i} more`;
		}
		value = next;
	}
	return value;
}

function parseName(raw: string | null): string | null {
	if (raw === null) {
		return null;
	}
	const name = raw.trim();
	if (!NAME_RE.test(name)) {
		return null;
	}
	return name;
}

function requireAdmin(interaction: ChatInputCommandInteraction): boolean {
	return interaction.client.bot.permissions.isAdminUser(interaction.user.id);
}

async function denyAdmin(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	await interaction.reply({
		content: "You don't have permission to use this command.",
		flags: MessageFlags.Ephemeral,
	});
}

function dmBody(
	drawName: string,
	recipientId: string,
	spendLimitCents: number | null,
): string {
	const limitLine =
		spendLimitCents === null
			? "No spend limit set."
			: `Spend limit: ${formatSpendLimit(spendLimitCents)}`;
	return `Secret Santa (${drawName}): you are buying for ${userMention(recipientId)}.\n${limitLine}`;
}

async function sendAssignmentDms(
	interaction: ChatInputCommandInteraction,
	drawName: string,
	spendLimitCents: number | null,
	pairs: SecretSantaAssignment[],
): Promise<string[]> {
	const failed: string[] = [];
	for (const pair of pairs) {
		try {
			const user = await interaction.client.users.fetch(pair.giverId);
			await user.send(dmBody(drawName, pair.recipientId, spendLimitCents));
		} catch {
			failed.push(pair.giverId);
		}
	}
	return failed;
}

export default class SecretSanta implements Command {
	data = new SlashCommandBuilder()
		.setName("secretsanta")
		.setDescription("Bot-wide Secret Santa draws")
		.addSubcommand((sc) =>
			sc
				.setName("init")
				.setDescription("Create a Secret Santa draw (admin)")
				.addStringOption((o) =>
					o
						.setName("name")
						.setDescription("Unique draw name")
						.setRequired(true)
						.setMaxLength(32),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("delete")
				.setDescription("Delete a draw and all its data (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("open")
				.setDescription("Open opt-in for a draw (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("close")
				.setDescription("Close opt-in for a draw (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("spendlimit")
				.setDescription("Set spend limit in USD (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				)
				.addNumberOption((o) =>
					o
						.setName("amount_usd")
						.setDescription("Spend limit in USD")
						.setRequired(true)
						.setMinValue(0),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("exclude")
				.setDescription(
					"Mutually exclude users from drawing each other (admin)",
				)
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				)
				.addUserOption((o) =>
					o.setName("user_one").setDescription("User").setRequired(true),
				)
				.addUserOption((o) =>
					o.setName("user_two").setDescription("User").setRequired(true),
				)
				.addUserOption((o) =>
					o.setName("user_three").setDescription("User").setRequired(false),
				)
				.addUserOption((o) =>
					o.setName("user_four").setDescription("User").setRequired(false),
				)
				.addUserOption((o) =>
					o.setName("user_five").setDescription("User").setRequired(false),
				)
				.addUserOption((o) =>
					o.setName("user_six").setDescription("User").setRequired(false),
				)
				.addUserOption((o) =>
					o.setName("user_seven").setDescription("User").setRequired(false),
				)
				.addUserOption((o) =>
					o.setName("user_eight").setDescription("User").setRequired(false),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("opt-in")
				.setDescription("Opt in to a draw")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("opt-out")
				.setDescription("Opt out of a draw")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("remove")
				.setDescription("Force-remove a participant (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				)
				.addUserOption((o) =>
					o.setName("user").setDescription("User to remove").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("draw")
				.setDescription("Draw pairings and DM participants (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("reroll")
				.setDescription("Redraw pairings (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("resend")
				.setDescription("Resend pairing DMs (admin)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(true),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("status")
				.setDescription("Show draw status (no pairings)")
				.addStringOption((o) =>
					o.setName("name").setDescription("Draw name").setRequired(false),
				),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const sub = interaction.options.getSubcommand();
		switch (sub) {
			case "init":
				return this.handleInit(interaction);
			case "delete":
				return this.handleDelete(interaction);
			case "open":
				return this.handleOpenClose(interaction, true);
			case "close":
				return this.handleOpenClose(interaction, false);
			case "spendlimit":
				return this.handleSpendLimit(interaction);
			case "exclude":
				return this.handleExclude(interaction);
			case "opt-in":
				return this.handleOptIn(interaction);
			case "opt-out":
				return this.handleOptOut(interaction);
			case "remove":
				return this.handleRemove(interaction);
			case "draw":
				return this.handleDraw(interaction, false);
			case "reroll":
				return this.handleDraw(interaction, true);
			case "resend":
				return this.handleResend(interaction);
			case "status":
				return this.handleStatus(interaction);
			default:
				await interaction.reply({
					content: "Unknown subcommand.",
					flags: MessageFlags.Ephemeral,
				});
		}
	}

	private async nameOrReply(
		interaction: ChatInputCommandInteraction,
		required = true,
	): Promise<string | null> {
		const raw = interaction.options.getString("name", required);
		if (raw === null) {
			return null;
		}
		const name = parseName(raw);
		if (!name) {
			await interaction.reply({
				content:
					"Invalid name. Use 1–32 characters: letters, numbers, `_`, `-`.",
				flags: MessageFlags.Ephemeral,
			});
			return null;
		}
		return name;
	}

	private async handleInit(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const repo = interaction.client.bot.secretSanta;
		if (await repo.get(name)) {
			await interaction.reply({
				content: `Draw \`${name}\` already exists.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await repo.create(name);
		await interaction.reply({
			content: `Created Secret Santa draw \`${name}\` (opt-in open).`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleDelete(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const deleted = await interaction.client.bot.secretSanta.delete(name);
		await interaction.reply({
			content: deleted
				? `Deleted draw \`${name}\`.`
				: `No draw named \`${name}\`.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleOpenClose(
		interaction: ChatInputCommandInteraction,
		open: boolean,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const updated = await interaction.client.bot.secretSanta.setOpen(
			name,
			open,
		);
		if (!updated) {
			await interaction.reply({
				content: `No draw named \`${name}\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.reply({
			content: open
				? `Opt-in open for \`${name}\`.`
				: `Opt-in closed for \`${name}\`.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleSpendLimit(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const usd = interaction.options.getNumber("amount_usd", true);
		const cents = Math.round(usd * 100);
		const updated = await interaction.client.bot.secretSanta.setSpendLimitCents(
			name,
			cents,
		);
		if (!updated) {
			await interaction.reply({
				content: `No draw named \`${name}\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.reply({
			content: `Spend limit for \`${name}\` set to ${formatSpendLimit(cents)}.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleExclude(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const repo = interaction.client.bot.secretSanta;
		if (!(await repo.get(name))) {
			await interaction.reply({
				content: `No draw named \`${name}\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const keys = [
			"user_one",
			"user_two",
			"user_three",
			"user_four",
			"user_five",
			"user_six",
			"user_seven",
			"user_eight",
		] as const;
		const userIds: string[] = [];
		for (const key of keys) {
			const user = interaction.options.getUser(key);
			if (user) {
				userIds.push(user.id);
			}
		}
		const unique = [...new Set(userIds)];
		if (unique.length < 2) {
			await interaction.reply({
				content: "Provide at least two distinct users to exclude.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const added = await repo.addExclusions(name, unique);
		await interaction.reply({
			content: `Added ${added} new exclusion pair(s) for \`${name}\` among ${unique.length} users.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleOptIn(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const repo = interaction.client.bot.secretSanta;
		const result = await repo.addParticipant(name, interaction.user.id);
		if (result === "missing") {
			await interaction.reply({
				content: `No draw named ${inlineCode(name)}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (result === "locked") {
			await interaction.reply({
				content: "This draw already has pairings; the roster is locked.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (result === "closed") {
			await interaction.reply({
				content: "Opt-in is closed for this draw.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.reply({
			content:
				result === "added"
					? `You opted in to ${inlineCode(name)}.`
					: `You are already opted in to ${inlineCode(name)}.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleOptOut(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const repo = interaction.client.bot.secretSanta;
		const result = await repo.removeParticipant(name, interaction.user.id);
		if (result === "missing") {
			await interaction.reply({
				content: `No draw named ${inlineCode(name)}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (result === "locked") {
			await interaction.reply({
				content: "This draw already has pairings; the roster is locked.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.reply({
			content:
				result === "removed"
					? `You opted out of ${inlineCode(name)}.`
					: `You were not opted in to ${inlineCode(name)}.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleRemove(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const repo = interaction.client.bot.secretSanta;
		const user = interaction.options.getUser("user", true);
		const result = await repo.removeParticipant(name, user.id);
		if (result === "missing") {
			await interaction.reply({
				content: `No draw named ${inlineCode(name)}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (result === "locked") {
			await interaction.reply({
				content: "This draw already has pairings; the roster is locked.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		await interaction.reply({
			content:
				result === "removed"
					? `Removed ${userMention(user.id)} from ${inlineCode(name)}.`
					: `${userMention(user.id)} was not in ${inlineCode(name)}.`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleStatus(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const raw = interaction.options.getString("name");
		const repo = interaction.client.bot.secretSanta;

		if (raw === null) {
			const draws = await repo.list();
			if (draws.length === 0) {
				await interaction.reply({
					content: "No Secret Santa draws.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			const lines: string[] = [];
			for (const draw of draws) {
				const count = await repo.participantCount(draw.name);
				lines.push(this.statusLine(draw, count));
			}
			await interaction.reply({
				content: lines.join("\n"),
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const name = parseName(raw);
		if (!name) {
			await interaction.reply({
				content:
					"Invalid name. Use 1–32 characters: letters, numbers, `_`, `-`.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const draw = await repo.get(name);
		if (!draw) {
			await interaction.reply({
				content: `No draw named \`${name}\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const participants = await repo.listParticipants(name);
		const exclusions = await repo.listExclusions(name);
		const embed = new EmbedBuilder()
			.setTitle(`Secret Santa: ${name}`)
			.addFields(
				{
					name: "Status",
					value: [
						draw.open ? "Opt-in open" : "Opt-in closed",
						draw.drawnAt ? "Pairings drawn" : "Not drawn",
						`Spend limit: ${formatSpendLimit(draw.spendLimitCents)}`,
						`Participants: ${participants.length}`,
					].join("\n"),
				},
				{
					name: "Participants",
					value: formatMentionList(participants),
				},
				{
					name: "Exclusions",
					value:
						exclusions.length === 0
							? "None"
							: exclusions
									.map(
										(e) => `${userMention(e.userA)} ↔ ${userMention(e.userB)}`,
									)
									.join("\n")
									.slice(0, 1024),
				},
			);

		await interaction.reply({
			embeds: [embed],
			flags: MessageFlags.Ephemeral,
		});
	}

	private statusLine(draw: SecretSantaDraw, count: number): string {
		const open = draw.open ? "open" : "closed";
		const drawn = draw.drawnAt ? "drawn" : "not drawn";
		return `\`${draw.name}\` — ${open}, ${drawn}, ${count} participant(s), ${formatSpendLimit(draw.spendLimitCents)}`;
	}

	private async handleResend(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const repo = interaction.client.bot.secretSanta;
		const draw = await repo.get(name);
		if (!draw) {
			await interaction.reply({
				content: `No draw named \`${name}\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (!draw.drawnAt) {
			await interaction.reply({
				content: `Draw \`${name}\` has no pairings yet.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const pairs = await repo.listAssignments(name);
		if (pairs.length === 0) {
			await interaction.reply({
				content: `Draw \`${name}\` has no pairings yet.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const failed = await sendAssignmentDms(
			interaction,
			name,
			draw.spendLimitCents,
			pairs,
		);
		const failText =
			failed.length === 0
				? "All DMs sent."
				: `DMs failed: ${failed.map((id) => userMention(id)).join(", ")}`;
		await interaction.editReply({
			content: `Resent ${pairs.length} pairing DM(s) for \`${name}\`. ${failText}`,
		});
	}

	private async handleDraw(
		interaction: ChatInputCommandInteraction,
		reroll: boolean,
	): Promise<void> {
		if (!requireAdmin(interaction)) {
			return denyAdmin(interaction);
		}
		const name = await this.nameOrReply(interaction);
		if (!name) {
			return;
		}
		const repo = interaction.client.bot.secretSanta;
		const draw = await repo.get(name);
		if (!draw) {
			await interaction.reply({
				content: `No draw named \`${name}\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (!reroll && draw.drawnAt) {
			await interaction.reply({
				content: `Draw \`${name}\` already has pairings. Use \`/secretsanta reroll\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (reroll && !draw.drawnAt) {
			await interaction.reply({
				content: `Draw \`${name}\` has not been drawn yet. Use \`/secretsanta draw\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const participants = await repo.listParticipants(name);
		if (participants.length < 2) {
			await interaction.reply({
				content: "Need at least 2 participants to draw.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const yesId = `secretsanta:${reroll ? "reroll" : "draw"}:yes:${interaction.id}`;
		const noId = `secretsanta:${reroll ? "reroll" : "draw"}:no:${interaction.id}`;
		const embed = new EmbedBuilder()
			.setTitle(reroll ? "Reroll pairings?" : "Draw pairings?")
			.setDescription("Do you really want to draw pairings now?")
			.addFields(
				{
					name: "Spend limit",
					value: formatSpendLimit(draw.spendLimitCents),
				},
				{
					name: `Participants (${participants.length})`,
					value: formatMentionList(participants),
				},
			);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(yesId)
				.setLabel("Yes")
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(noId)
				.setLabel("No")
				.setStyle(ButtonStyle.Secondary),
		);

		const response = await interaction.reply({
			embeds: [embed],
			components: [row],
			flags: MessageFlags.Ephemeral,
		});

		const click = await response
			.awaitMessageComponent({
				filter: (i) =>
					(i.customId === yesId || i.customId === noId) &&
					i.user.id === interaction.user.id,
				time: 60_000,
			})
			.catch(async () => {
				await interaction
					.editReply({
						embeds: [embed],
						components: [],
						content: "Confirmation timed out.",
					})
					.catch(() => {});
				return null;
			});
		if (!click) return;

		if (click.customId === noId) {
			await click.update({
				content: "Cancelled.",
				embeds: [],
				components: [],
			});
			return;
		}

		await click.deferUpdate();
		const result = await repo.finalizeAssignments(
			name,
			draw.revision,
			reroll,
			(currentParticipants, exclusions) => {
				const assignment = assignSecretSanta(
					currentParticipants,
					exclusions.map((e) => [e.userA, e.userB] as const),
				);
				return assignment
					? [...assignment.entries()].map(([giverId, recipientId]) => ({
							giverId,
							recipientId,
						}))
					: null;
			},
		);

		if (result.status !== "committed") {
			const content = {
				missing: `No draw named ${inlineCode(name)}.`,
				stale:
					"This draw changed while awaiting confirmation. No changes made.",
				"wrong-mode":
					"This draw changed while awaiting confirmation. No changes made.",
				"too-few": "Need at least 2 participants to draw. No changes made.",
				impossible:
					"Could not find valid pairings with the current participants and exclusions. No changes made.",
			}[result.status];
			await interaction.editReply({ content, embeds: [], components: [] });
			return;
		}

		const failed = await sendAssignmentDms(
			interaction,
			name,
			result.draw.spendLimitCents,
			result.pairs,
		);
		const failText =
			failed.length === 0
				? "All DMs sent."
				: `DMs failed: ${failed.map((id) => userMention(id)).join(", ")}`;

		await interaction.editReply({
			content: `${reroll ? "Rerolled" : "Drew"} ${result.pairs.length} pairing(s) for ${inlineCode(name)}. ${failText}`,
			embeds: [],
			components: [],
		});
	}
}
