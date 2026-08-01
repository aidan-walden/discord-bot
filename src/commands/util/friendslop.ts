import {
	type ChatInputCommandInteraction,
	escapeMarkdown,
	hyperlink,
	MessageFlags,
	SlashCommandBuilder,
	type User,
	userMention,
} from "discord.js";
import type Command from "../../models/Command";
import type SteamService from "../../services/SteamService";
import { SteamLibraryUnavailableError } from "../../services/SteamService";

const MEMBER_OPTION_NAMES = [
	"member_one",
	"member_two",
	"member_three",
	"member_four",
	"member_five",
	"member_six",
	"member_seven",
	"member_eight",
	"member_nine",
	"member_ten",
	"member_eleven",
	"member_twelve",
	"member_thirteen",
	"member_fourteen",
	"member_fifteen",
	"member_sixteen",
	"member_seventeen",
	"member_eighteen",
	"member_nineteen",
	"member_twenty",
	"member_twenty_one",
	"member_twenty_two",
	"member_twenty_three",
	"member_twenty_four",
	"member_twenty_five",
] as const;

function buildCommandData(): SlashCommandBuilder {
	const builder = new SlashCommandBuilder()
		.setName("friendslop")
		.setDescription(
			"Pick a random online co-op Steam game everyone selected owns",
		);

	for (const [index, name] of MEMBER_OPTION_NAMES.entries()) {
		builder.addUserOption((option) =>
			option
				.setName(name)
				.setDescription(`Friend ${index + 1}`)
				.setRequired(index < 2),
		);
	}
	return builder;
}

function collectUsers(interaction: ChatInputCommandInteraction): User[] {
	const users: User[] = [];
	const seen = new Set<string>();
	for (const name of MEMBER_OPTION_NAMES) {
		const user = interaction.options.getUser(name);
		if (!user || seen.has(user.id)) {
			continue;
		}
		seen.add(user.id);
		users.push(user);
	}
	return users;
}

type ProfileConnectedAccount = {
	type?: unknown;
	id?: unknown;
};

type ProfileResponse = {
	connected_accounts?: unknown;
};

function isProfileResponse(value: unknown): value is ProfileResponse {
	return typeof value === "object" && value !== null;
}

function steamIdFromProfile(profile: unknown): string | null {
	if (
		!isProfileResponse(profile) ||
		!Array.isArray(profile.connected_accounts)
	) {
		return null;
	}
	for (const account of profile.connected_accounts) {
		if (typeof account !== "object" || account === null) {
			continue;
		}
		const connected = account as ProfileConnectedAccount;
		if (connected.type !== "steam") {
			continue;
		}
		if (typeof connected.id !== "string") {
			continue;
		}
		const steamId = connected.id.trim();
		if (steamId.length === 0) {
			continue;
		}
		return steamId;
	}
	return null;
}

async function resolveSteamIds(
	interaction: ChatInputCommandInteraction,
	users: readonly User[],
): Promise<
	| { ok: true; pairs: Array<{ user: User; steamId: string }> }
	| { ok: false; missing: User[] }
> {
	const results = await Promise.all(
		users.map(async (user) => {
			const profile = await interaction.client.rest.get(
				`/users/${user.id}/profile`,
				{
					query: new URLSearchParams({
						type: "account_popout",
						with_mutual_guilds: "false",
						with_mutual_friends: "false",
						with_mutual_friends_count: "false",
					}),
				},
			);
			return { user, steamId: steamIdFromProfile(profile) };
		}),
	);

	const missing = results
		.filter((result) => result.steamId === null)
		.map((result) => result.user);
	if (missing.length > 0) {
		return { ok: false, missing };
	}

	return {
		ok: true,
		pairs: results.map((result) => ({
			user: result.user,
			steamId: result.steamId as string,
		})),
	};
}

export default class Friendslop implements Command {
	data = buildCommandData();

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const steam: SteamService = interaction.client.bot.steam;
		if (!steam.isAvailable()) {
			await interaction.reply({
				content: "Steam API is not configured.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const users = collectUsers(interaction);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		let steamIdToUser: Map<string, User> | undefined;
		try {
			const resolved = await resolveSteamIds(interaction, users);
			if (!resolved.ok) {
				const mentions = resolved.missing
					.map((user) => userMention(user.id))
					.join(", ");
				await interaction.editReply({
					content: `These users do not have Steam connected: ${mentions}`,
					allowedMentions: { parse: [] },
				});
				return;
			}

			steamIdToUser = new Map(
				resolved.pairs.map((pair) => [pair.steamId, pair.user]),
			);
			const game = await steam.findRandomCommonOnlineCoopGame(
				resolved.pairs.map((pair) => pair.steamId),
			);

			if (!game) {
				await interaction.editReply({
					content: "No online co-op Steam game is owned by everyone selected.",
					allowedMentions: { parse: [] },
				});
				return;
			}

			const storeUrl = `https://store.steampowered.com/app/${game.appid}`;
			await interaction.editReply({
				content: `Everyone owns ${hyperlink(escapeMarkdown(game.name), storeUrl)}.`,
				allowedMentions: { parse: [] },
			});
		} catch (error) {
			if (error instanceof SteamLibraryUnavailableError) {
				const mentions = error.steamIds
					.flatMap((steamId) => {
						const user = steamIdToUser?.get(steamId);
						return user ? [userMention(user.id)] : [];
					})
					.join(", ");
				await interaction.editReply({
					content: `These users must set Steam game details to public: ${mentions || "a selected user"}`,
					allowedMentions: { parse: [] },
				});
				return;
			}

			console.error("friendslop failed:", error);
			await interaction.editReply({
				content: "Failed to find a common online co-op game.",
				allowedMentions: { parse: [] },
			});
		}
	}
}
