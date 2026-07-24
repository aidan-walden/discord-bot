import {
	ActionRowBuilder,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	bold,
	type ChatInputCommandInteraction,
	ComponentType,
	channelMention,
	escapeMarkdown,
	type Guild,
	GuildMember,
	inlineCode,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	SlashCommandBuilder,
	TextInputBuilder,
	TextInputStyle,
	userMention,
} from "discord.js";
import type Command from "../../models/Command";
import {
	FRIENDLY_REGION_TO_PLATFORM,
	parseFriendlyRegion,
	parseRiotId,
	platformToRegion,
} from "../../services/RiotGamesService";

type Bot = ChatInputCommandInteraction["client"]["bot"];

type Field = {
	id: string;
	label: string;
	min: number;
	max: number;
	required?: boolean;
};

export type Action = {
	id: string;
	label: string;
	style: ButtonStyle;
	title: string;
	fields: Field[];
	needsGuild?: boolean;
	run(
		values: Record<string, string>,
		ctx: {
			modal: ModalSubmitInteraction | ButtonInteraction;
			bot: Bot;
			guild: Guild;
		},
	): Promise<string>;
};

const ID_FIELD = (id: string, label: string): Field => ({
	id,
	label,
	min: 15,
	max: 20,
});

export function snowflake(value: string | undefined, label: string): string {
	const v = value?.trim() ?? "";
	if (!/^\d{15,20}$/.test(v)) {
		throw new Error(
			`${inlineCode(escapeMarkdown(String(value)))} is not a valid ${label}.`,
		);
	}
	return v;
}

// Data-driven panel: one entry per button. Adding an action means adding a row here.
export const ACTIONS: Action[] = [
	{
		id: "kick_voice",
		label: "⛔ Kick from Voice",
		style: ButtonStyle.Danger,
		title: "Kick from Voice",
		fields: [ID_FIELD("user_id", "User ID")],
		needsGuild: true,
		run: async ({ user_id }, { guild }) => {
			const id = snowflake(user_id, "user ID");
			const member = await guild.members.fetch(id);
			if (!member.voice.channel) {
				throw new Error(`${userMention(id)} is not in a voice channel.`);
			}
			await member.voice.disconnect();
			return `Kicked ${userMention(id)} from voice.`;
		},
	},
	{
		id: "delete_message",
		label: "🗑️ Delete Message",
		style: ButtonStyle.Danger,
		title: "Delete Message",
		fields: [ID_FIELD("message_id", "Message ID")],
		run: async ({ message_id }, { modal }) => {
			const id = snowflake(message_id, "message ID");
			const channel = modal.channel;
			if (!channel?.isTextBased() || channel.isDMBased()) {
				throw new Error("Can't delete messages in this channel.");
			}
			await channel.messages.delete(id);
			return `Deleted message ${inlineCode(id)}.`;
		},
	},
	{
		id: "change_nick",
		label: "👤 Change Nickname",
		style: ButtonStyle.Primary,
		title: "Change Nickname",
		fields: [
			ID_FIELD("user_id", "User ID"),
			{ id: "nickname", label: "New Nickname", min: 1, max: 32 },
		],
		needsGuild: true,
		run: async ({ user_id, nickname }, { guild }) => {
			const id = snowflake(user_id, "user ID");
			const member = await guild.members.fetch(id);
			await member.setNickname(nickname ?? null);
			return `Set ${userMention(id)}'s nickname to ${bold(escapeMarkdown(String(nickname)))}.`;
		},
	},
	{
		id: "ban_gpt",
		label: "🚫 Ban from GPT",
		style: ButtonStyle.Danger,
		title: "Ban from GPT",
		fields: [ID_FIELD("user_id", "User ID")],
		run: async ({ user_id }, { bot }) => {
			const id = snowflake(user_id, "user ID");
			await bot.permissions.gptUserBans.add(id);
			return `Banned ${userMention(id)} from GPT.`;
		},
	},
	{
		id: "pardon_gpt",
		label: "✅ Pardon from GPT",
		style: ButtonStyle.Success,
		title: "Pardon from GPT",
		fields: [ID_FIELD("user_id", "User ID")],
		run: async ({ user_id }, { bot }) => {
			const id = snowflake(user_id, "user ID");
			await bot.permissions.gptUserBans.remove(id);
			return `Pardoned ${userMention(id)} from GPT.`;
		},
	},
	{
		id: "set_gpt_rate_limit",
		label: "⏱️ Set GPT Rate Limit",
		style: ButtonStyle.Primary,
		title: "Set GPT Rate Limit",
		fields: [
			ID_FIELD("user_id", "User ID"),
			{
				id: "requests_per_hour",
				label: "Limit (0 = default, -1 = unlimited)",
				min: 1,
				max: 10,
			},
		],
		run: async ({ user_id, requests_per_hour }, { bot }) => {
			const id = snowflake(user_id, "user ID");
			const rawLimit = requests_per_hour?.trim() ?? "";
			if (!/^-?\d+$/.test(rawLimit)) {
				throw new Error("Rate limit must be -1, 0, or a positive integer.");
			}
			const limit = Number(rawLimit);
			// Range validation lives in setOverride, next to the DB constraint.
			await bot.llmRateLimits.setOverride(id, limit);
			if (limit === -1) {
				return `Set ${userMention(id)}'s GPT rate limit to unlimited.`;
			}
			if (limit === 0) {
				return `Restored ${userMention(id)}'s default GPT rate limit.`;
			}
			return `Set ${userMention(id)}'s GPT rate limit to ${limit} requests per hour.`;
		},
	},
	{
		id: "ban_music",
		label: "🚫 Ban from 🎵Music",
		style: ButtonStyle.Danger,
		title: "Ban from Music",
		fields: [ID_FIELD("user_id", "User ID")],
		run: async ({ user_id }, { bot }) => {
			const id = snowflake(user_id, "user ID");
			await bot.permissions.musicUserBans.add(id);
			return `Banned ${userMention(id)} from music.`;
		},
	},
	{
		id: "pardon_music",
		label: "✅ Pardon from 🎵Music",
		style: ButtonStyle.Success,
		title: "Pardon from Music",
		fields: [ID_FIELD("user_id", "User ID")],
		run: async ({ user_id }, { bot }) => {
			const id = snowflake(user_id, "user ID");
			await bot.permissions.musicUserBans.remove(id);
			return `Pardoned ${userMention(id)} from music.`;
		},
	},
	{
		id: "ban_guild_music",
		label: "🚫 Ban Guild from 🎵Music",
		style: ButtonStyle.Danger,
		title: "Ban Guild from Music",
		fields: [ID_FIELD("guild_id", "Guild ID")],
		run: async ({ guild_id }, { bot }) => {
			const id = snowflake(guild_id, "guild ID");
			await bot.permissions.musicGuildBans.add(id);
			return `Banned guild ${inlineCode(id)} from music.`;
		},
	},
	{
		id: "pardon_guild_music",
		label: "✅ Pardon Guild from 🎵Music",
		style: ButtonStyle.Success,
		title: "Pardon Guild from Music",
		fields: [ID_FIELD("guild_id", "Guild ID")],
		run: async ({ guild_id }, { bot }) => {
			const id = snowflake(guild_id, "guild ID");
			await bot.permissions.musicGuildBans.remove(id);
			return `Pardoned guild ${inlineCode(id)} from music.`;
		},
	},
	{
		id: "set_main_channel",
		label: "📌 Set Main Channel",
		style: ButtonStyle.Primary,
		title: "Set Main Channel",
		fields: [],
		needsGuild: true,
		run: async (_values, { bot, guild, modal }) => {
			const channel = modal.channel;
			if (!channel?.isTextBased() || channel.isDMBased()) {
				throw new Error("Can't set main channel here.");
			}
			await bot.guildSettings.setMainChannel(guild.id, channel.id);
			return `Main channel set to ${channelMention(channel.id)}.`;
		},
	},
	{
		id: "riot_to_puuid",
		label: "🎮 Riot → PUUID",
		style: ButtonStyle.Primary,
		title: "Riot ID → PUUID",
		fields: [
			{ id: "riot_id", label: "Riot ID (Name#TAG)", min: 3, max: 32 },
			{ id: "region", label: "Region (NA, EUW, …)", min: 2, max: 5 },
		],
		run: async ({ riot_id = "", region = "" }, { bot }) => {
			if (!bot.riot.isAvailable()) {
				throw new Error("Riot API is not configured.");
			}
			const parsed = parseRiotId(riot_id);
			if (!parsed) {
				throw new Error("Riot ID must be `GameName#TAG`.");
			}
			const { gameName, tagLine } = parsed;
			const platform = parseFriendlyRegion(region);
			if (!platform) {
				throw new Error(
					`Unknown region. Use one of: ${Object.keys(FRIENDLY_REGION_TO_PLATFORM).join(", ")}.`,
				);
			}
			const account = await bot.riot.getAccountByRiotId(
				platformToRegion(platform),
				gameName,
				tagLine,
			);
			if (!account) {
				throw new Error("No Riot account found for that ID/region.");
			}
			return `${bold(escapeMarkdown(account.gameName))}#${escapeMarkdown(account.tagLine)} → ${inlineCode(account.puuid)}`;
		},
	},
];

export const ACTIONS_BY_ID = new Map(
	ACTIONS.map((action) => [action.id, action]),
);

// Button rows (≤5 buttons each), mirroring the old panel grouping.
export const ROWS: string[][] = [
	["kick_voice", "delete_message", "change_nick"],
	["ban_gpt", "pardon_gpt", "set_gpt_rate_limit"],
	["ban_music", "pardon_music", "ban_guild_music", "pardon_guild_music"],
	["set_main_channel", "riot_to_puuid"],
];

export function buildPanel(): ActionRowBuilder<ButtonBuilder>[] {
	return ROWS.map((ids) =>
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			ids.flatMap((id) => {
				const action = ACTIONS_BY_ID.get(id);
				if (!action) return [];
				return [
					new ButtonBuilder()
						.setCustomId(action.id)
						.setLabel(action.label)
						.setStyle(action.style),
				];
			}),
		),
	);
}

function buildModal(action: Action, customId: string): ModalBuilder {
	const modal = new ModalBuilder().setCustomId(customId).setTitle(action.title);
	for (const field of action.fields) {
		modal.addComponents(
			new ActionRowBuilder<TextInputBuilder>().addComponents(
				new TextInputBuilder()
					.setCustomId(field.id)
					.setLabel(field.label)
					.setStyle(TextInputStyle.Short)
					.setMinLength(field.min)
					.setMaxLength(field.max)
					.setRequired(field.required ?? true),
			),
		);
	}
	return modal;
}

export default class Admin implements Command {
	data = new SlashCommandBuilder()
		.setName("admin")
		.setDescription("Admin control panel.");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const bot = interaction.client.bot;
		if (!bot.permissions.isAdminUser(interaction.user.id)) {
			await interaction.reply({
				content: "You don't have permission to use this command.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (
			!interaction.inGuild() ||
			!(interaction.member instanceof GuildMember) ||
			!interaction.channel?.isTextBased()
		) {
			await interaction.reply({
				content: "You can't use that command here.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const response = await interaction.reply({
			content: "Admin Panel. Select an option within 60 seconds.",
			components: buildPanel(),
			flags: MessageFlags.Ephemeral,
		});

		const collector = response.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: 60_000,
		});

		collector.on("collect", (button) => this.handleButton(button, bot));
	}

	private async handleButton(
		button: ButtonInteraction,
		bot: Bot,
	): Promise<void> {
		const action = ACTIONS_BY_ID.get(button.customId);
		if (!action) return;

		if (action.fields.length === 0) {
			await this.runAction(action, {}, button, bot, button.guild);
			return;
		}

		const modalId = `${button.customId}:${button.id}`;
		await button.showModal(buildModal(action, modalId));

		let modal: ModalSubmitInteraction;
		try {
			modal = await button.awaitModalSubmit({
				time: 60_000,
				filter: (i) => i.customId === modalId && i.user.id === button.user.id,
			});
		} catch {
			return; // dismissed or timed out
		}

		const values = Object.fromEntries(
			action.fields.map((f) => [f.id, modal.fields.getTextInputValue(f.id)]),
		);
		await this.runAction(action, values, modal, bot, modal.guild);
	}

	private async runAction(
		action: Action,
		values: Record<string, string>,
		interaction: ModalSubmitInteraction | ButtonInteraction,
		bot: Bot,
		guild: Guild | null,
	): Promise<void> {
		if (action.needsGuild && !guild) {
			await interaction.reply({
				content: "This action only works in a server.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		try {
			const result = await action.run(values, {
				modal: interaction,
				bot,
				guild: guild as Guild,
			});
			await interaction.reply({
				content: result,
				flags: MessageFlags.Ephemeral,
			});
		} catch (error) {
			await interaction.reply({
				content: error instanceof Error ? error.message : "Action failed.",
				flags: MessageFlags.Ephemeral,
			});
		}
	}
}
