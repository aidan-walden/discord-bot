import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	escapeMarkdown,
	MessageFlags,
	SlashCommandBuilder,
	userMention,
} from "discord.js";
import type Command from "../../models/Command";
import {
	FLEX_QUEUE,
	parseFriendlyRegion,
	platformToRegion,
	profileIconUrl,
	queueName,
	type RiotLeagueEntry,
	type RiotMatch,
	type RiotPlatform,
	SOLO_QUEUE,
} from "../../services/RiotGamesService";

const FRIENDLY_REGIONS = [
	"NA",
	"EUW",
	"EUNE",
	"KR",
	"BR",
	"LAN",
	"LAS",
	"OCE",
	"JP",
	"TR",
	"RU",
	"PH",
	"SG",
	"TH",
	"TW",
	"VN",
] as const;

function parseRiotId(
	raw: string,
): { gameName: string; tagLine: string } | null {
	const hash = raw.indexOf("#");
	if (hash <= 0 || hash === raw.length - 1) {
		return null;
	}
	const gameName = raw.slice(0, hash).trim();
	const tagLine = raw.slice(hash + 1).trim();
	if (!gameName || !tagLine) {
		return null;
	}
	return { gameName, tagLine };
}

function formatRank(entry: RiotLeagueEntry | undefined): string {
	if (!entry) {
		return "Unranked";
	}
	const games = entry.wins + entry.losses;
	const wr = games > 0 ? Math.round((entry.wins / games) * 100) : 0;
	return `${entry.tier} ${entry.rank} ${entry.leaguePoints} LP · ${entry.wins}W ${entry.losses}L (${wr}%)`;
}

function formatDuration(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatPlaytime(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	return `${hours}h ${minutes}m`;
}

function matchLine(match: RiotMatch, puuid: string): string | null {
	const p = match.info.participants.find((part) => part.puuid === puuid);
	if (!p) {
		return null;
	}
	const result = p.win ? "W" : "L";
	const champ = p.championName || `Champ ${p.championId}`;
	const queue = queueName(match.info.queueId);
	return `${result} ${champ} ${p.kills}/${p.deaths}/${p.assists} · ${queue} · ${formatDuration(match.info.gameDuration)}`;
}

const PLATFORM_LABEL: Record<RiotPlatform, string> = {
	na1: "NA",
	euw1: "EUW",
	eun1: "EUNE",
	kr: "KR",
	br1: "BR",
	la1: "LAN",
	la2: "LAS",
	oc1: "OCE",
	jp1: "JP",
	tr1: "TR",
	ru: "RU",
	ph2: "PH",
	sg2: "SG",
	th2: "TH",
	tw2: "TW",
	vn2: "VN",
};

function platformLabel(platform: RiotPlatform): string {
	return PLATFORM_LABEL[platform] ?? platform.toUpperCase();
}

export default class Lol implements Command {
	data = new SlashCommandBuilder()
		.setName("lol")
		.setDescription("League of Legends stats and account linking")
		.addSubcommand((sc) =>
			sc
				.setName("view")
				.setDescription("View League stats for a Discord member")
				.addUserOption((o) =>
					o
						.setName("member")
						.setDescription("Discord member to view (default: you)")
						.setRequired(false),
				),
		)
		.addSubcommand((sc) =>
			sc
				.setName("map")
				.setDescription("Link a Discord member to a League account")
				.addUserOption((o) =>
					o
						.setName("member")
						.setDescription("Discord member to link")
						.setRequired(true),
				)
				.addStringOption((o) =>
					o
						.setName("riot_id")
						.setDescription("Riot ID as GameName#TAG")
						.setRequired(true),
				)
				.addStringOption((o) =>
					o
						.setName("region")
						.setDescription("League region (default: NA)")
						.setRequired(false)
						.addChoices(
							...FRIENDLY_REGIONS.map((r) => ({ name: r, value: r })),
						),
				),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const sub = interaction.options.getSubcommand();
		if (sub === "map") {
			await this.handleMap(interaction);
			return;
		}
		await this.handleView(interaction);
	}

	private async handleMap(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const member = interaction.options.getUser("member", true);
		const riotIdRaw = interaction.options.getString("riot_id", true);
		const regionRaw = interaction.options.getString("region") ?? "NA";

		if (
			member.id !== interaction.user.id &&
			!interaction.client.bot.permissions.isAdminUser(interaction.user.id)
		) {
			await interaction.reply({
				content: "You can only map your own account (admins can map others).",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (!interaction.client.bot.riot.isAvailable()) {
			await interaction.reply({
				content: "Riot API is not configured.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const riotId = parseRiotId(riotIdRaw);
		if (!riotId) {
			await interaction.reply({
				content: "Riot ID must be `GameName#TAG`.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const platform = parseFriendlyRegion(regionRaw);
		if (!platform) {
			await interaction.reply({
				content: `Unknown region. Use one of: ${FRIENDLY_REGIONS.join(", ")}.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const account = await interaction.client.bot.riot.getAccountByRiotId(
			platformToRegion(platform),
			riotId.gameName,
			riotId.tagLine,
		);
		if (!account) {
			await interaction.editReply("No Riot account found for that ID/region.");
			return;
		}

		await interaction.client.bot.riotLinks.upsert({
			userId: member.id,
			puuid: account.puuid,
			platform,
			gameName: account.gameName,
			tagLine: account.tagLine,
		});

		await interaction.editReply(
			`Linked ${userMention(member.id)} → **${escapeMarkdown(account.gameName)}#${escapeMarkdown(account.tagLine)}** (${platformLabel(platform)}).`,
		);
	}

	private async handleView(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const member = interaction.options.getUser("member") ?? interaction.user;

		if (!interaction.client.bot.riot.isAvailable()) {
			await interaction.reply({
				content: "Riot API is not configured.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const link = await interaction.client.bot.riotLinks.getPrimaryByUserId(
			member.id,
		);
		if (!link) {
			await interaction.reply({
				content: `${userMention(member.id)} has no League account mapped. Use \`/lol map\`.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply();

		const [view, playtimeSeconds] = await Promise.all([
			interaction.client.bot.riot.getLolView(link.platform, link.puuid, {
				gameName: link.gameName,
				tagLine: link.tagLine,
			}),
			interaction.client.bot.riotMatches.sumTimePlayedForUser(member.id),
		]);

		const solo = view.entries.find((e) => e.queueType === SOLO_QUEUE);
		const flex = view.entries.find((e) => e.queueType === FLEX_QUEUE);

		const recentLines = view.matches
			.map((m) => matchLine(m, link.puuid))
			.filter((line): line is string => line !== null);

		const embed = new EmbedBuilder()
			.setTitle(
				`${escapeMarkdown(view.gameName)}#${escapeMarkdown(view.tagLine)} · ${platformLabel(link.platform)}`,
			)
			.setDescription(userMention(member.id))
			.addFields(
				{ name: "Solo/Duo", value: formatRank(solo), inline: true },
				{ name: "Flex", value: formatRank(flex), inline: true },
				{
					name: "Playtime (across all paired accounts)",
					value: formatPlaytime(playtimeSeconds),
				},
			);

		if (view.summoner) {
			embed.setFooter({ text: `Level ${view.summoner.summonerLevel}` });
			embed.setThumbnail(profileIconUrl(view.summoner.profileIconId));
		}

		if (view.active) {
			const self = view.active.participants.find((p) => p.puuid === link.puuid);
			const champ = self ? `Champ ${self.championId}` : "Unknown";
			embed.addFields({
				name: "In Game",
				value: `${champ} · ${queueName(view.active.gameQueueConfigId)} · ${formatDuration(view.active.gameLength)}`,
			});
		}

		if (recentLines.length > 0) {
			embed.addFields({
				name: "Recent",
				value: recentLines.map((l) => escapeMarkdown(l)).join("\n"),
			});
		}

		if (view.history.length > 0) {
			embed.addFields({
				name: "Rank History",
				value: view.history
					.map(
						(h) =>
							`${h.tier} ${h.rank} ${h.leaguePoints} LP (${h.wins}W ${h.losses}L)`,
					)
					.join("\n"),
			});
		}

		await interaction.editReply({ embeds: [embed] });
	}
}
