import { describe, expect, mock, test } from "bun:test";
import {
	ApplicationCommandOptionType,
	type ChatInputCommandInteraction,
	escapeMarkdown,
	hyperlink,
	MessageFlags,
	userMention,
} from "discord.js";
import { SteamLibraryUnavailableError } from "../../services/SteamService";
import Friendslop from "./friendslop";

const MEMBER_NAMES = [
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

type BuildOpts = {
	available?: boolean;
	users?: Record<string, { id: string } | null>;
	profiles?: Record<string, unknown>;
	game?: { appid: number; name: string } | null;
	steamError?: unknown;
};

function buildInteraction(opts: BuildOpts = {}) {
	const usersByOption: Record<string, { id: string } | null> = {
		member_one: { id: "u1" },
		member_two: { id: "u2" },
		...opts.users,
	};

	const getUser = mock((name: string) => usersByOption[name] ?? null);
	const restGet = mock(async (route: string) => {
		const match = /^\/users\/([^/]+)\/profile$/.exec(route);
		const userId = match?.[1] ?? "";
		if (opts.profiles && userId in opts.profiles) {
			return opts.profiles[userId];
		}
		return {
			connected_accounts: [{ type: "steam", id: `steam-${userId}` }],
		};
	});

	const findRandomCommonMultiplayerGame = mock(async () => {
		if (opts.steamError !== undefined) {
			throw opts.steamError;
		}
		return opts.game === undefined
			? { appid: 730, name: "Counter-Strike 2" }
			: opts.game;
	});

	const interaction = {
		options: { getUser },
		client: {
			rest: { get: restGet },
			bot: {
				steam: {
					isAvailable: mock(() => opts.available ?? true),
					findRandomCommonMultiplayerGame,
				},
			},
		},
		reply: mock(async () => undefined),
		deferReply: mock(async () => undefined),
		editReply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;

	return {
		interaction,
		restGet,
		findRandomCommonMultiplayerGame,
	};
}

describe("Friendslop", () => {
	test("defines 25 user options with first two required", () => {
		const command = new Friendslop().data.toJSON();
		expect(command.name).toBe("friendslop");
		expect(command.options).toHaveLength(25);
		expect(command.options?.map((option) => option.name)).toEqual([
			...MEMBER_NAMES,
		]);
		expect(command.options?.[0]).toMatchObject({
			type: ApplicationCommandOptionType.User,
			name: "member_one",
			required: true,
		});
		expect(command.options?.[1]).toMatchObject({
			type: ApplicationCommandOptionType.User,
			name: "member_two",
			required: true,
		});
		for (const option of command.options?.slice(2) ?? []) {
			expect(option).toMatchObject({
				type: ApplicationCommandOptionType.User,
				required: false,
			});
		}
	});

	test("replies ephemerally when Steam is unconfigured without deferring", async () => {
		const { interaction, findRandomCommonMultiplayerGame } = buildInteraction({
			available: false,
		});
		await new Friendslop().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Steam API is not configured.",
			flags: MessageFlags.Ephemeral,
		});
		expect(interaction.deferReply).not.toHaveBeenCalled();
		expect(findRandomCommonMultiplayerGame).not.toHaveBeenCalled();
	});

	test("fetches Discord profiles via REST with expected query and dedupes users", async () => {
		const { interaction, restGet, findRandomCommonMultiplayerGame } =
			buildInteraction({
				users: {
					member_one: { id: "u1" },
					member_two: { id: "u2" },
					member_three: { id: "u1" },
				},
			});

		await new Friendslop().execute(interaction);

		expect(interaction.deferReply).toHaveBeenCalledWith({
			flags: MessageFlags.Ephemeral,
		});
		expect(restGet).toHaveBeenCalledTimes(2);
		expect(restGet).toHaveBeenCalledWith("/users/u1/profile", {
			query: new URLSearchParams({
				type: "account_popout",
				with_mutual_guilds: "false",
				with_mutual_friends: "false",
				with_mutual_friends_count: "false",
			}),
		});
		expect(restGet).toHaveBeenCalledWith("/users/u2/profile", {
			query: new URLSearchParams({
				type: "account_popout",
				with_mutual_guilds: "false",
				with_mutual_friends: "false",
				with_mutual_friends_count: "false",
			}),
		});
		expect(findRandomCommonMultiplayerGame).toHaveBeenCalledWith([
			"steam-u1",
			"steam-u2",
		]);
	});

	test("trims surrounding whitespace on connected Steam IDs", async () => {
		const { interaction, findRandomCommonMultiplayerGame } = buildInteraction({
			profiles: {
				u1: {
					connected_accounts: [{ type: "steam", id: "  steam-u1  " }],
				},
				u2: {
					connected_accounts: [{ type: "steam", id: "\tsteam-u2\n" }],
				},
			},
		});

		await new Friendslop().execute(interaction);

		expect(findRandomCommonMultiplayerGame).toHaveBeenCalledWith([
			"steam-u1",
			"steam-u2",
		]);
	});

	test("lists all missing Steam links without calling Steam", async () => {
		const { interaction, findRandomCommonMultiplayerGame } = buildInteraction({
			users: {
				member_one: { id: "u1" },
				member_two: { id: "u2" },
				member_three: { id: "u3" },
			},
			profiles: {
				u1: { connected_accounts: [] },
				u2: {
					connected_accounts: [{ type: "steam", id: "steam-u2" }],
				},
				u3: { connected_accounts: [{ type: "spotify", id: "x" }] },
			},
		});

		await new Friendslop().execute(interaction);

		expect(findRandomCommonMultiplayerGame).not.toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledWith({
			content: `These users do not have Steam connected: ${userMention("u1")}, ${userMention("u3")}`,
			allowedMentions: { parse: [] },
		});
	});

	test("replies with escaped name and store hyperlink on success", async () => {
		const { interaction } = buildInteraction({
			game: { appid: 570, name: "Dota_2" },
		});
		await new Friendslop().execute(interaction);

		expect(interaction.editReply).toHaveBeenCalledWith({
			content: `Everyone owns ${hyperlink(escapeMarkdown("Dota_2"), "https://store.steampowered.com/app/570")}.`,
			allowedMentions: { parse: [] },
		});
	});

	test("reports when no common multiplayer game exists", async () => {
		const { interaction } = buildInteraction({ game: null });
		await new Friendslop().execute(interaction);

		expect(interaction.editReply).toHaveBeenCalledWith({
			content: "No multiplayer Steam game is owned by everyone selected.",
			allowedMentions: { parse: [] },
		});
	});

	test("maps private library errors back to the Discord user", async () => {
		const { interaction } = buildInteraction({
			steamError: new SteamLibraryUnavailableError("steam-u2"),
		});
		await new Friendslop().execute(interaction);

		expect(interaction.editReply).toHaveBeenCalledWith({
			content: `${userMention("u2")} must set Steam game details to public.`,
			allowedMentions: { parse: [] },
		});
	});

	test("replies with a generic failure on other errors", async () => {
		const { interaction } = buildInteraction({
			steamError: new Error("boom"),
		});
		await new Friendslop().execute(interaction);

		expect(interaction.editReply).toHaveBeenCalledWith({
			content: "Failed to find a common multiplayer game.",
			allowedMentions: { parse: [] },
		});
	});
});
