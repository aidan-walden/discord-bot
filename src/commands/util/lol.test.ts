import { describe, expect, mock, test } from "bun:test";
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import Lol from "./lol";

type BuildOpts = {
	subcommand?: "view" | "map";
	admin?: boolean;
	executingUserId?: string;
	memberId?: string | null;
	riotId?: string | null;
	region?: string | null;
	riotAvailable?: boolean;
	link?: {
		userId: string;
		puuid: string;
		platform: "na1";
		gameName: string;
		tagLine: string;
	} | null;
	account?: { puuid: string; gameName: string; tagLine: string } | null;
};

function buildInteraction(opts: BuildOpts = {}): ChatInputCommandInteraction {
	const subcommand = opts.subcommand ?? "view";
	const executingUserId = opts.executingUserId ?? "self";
	const memberId =
		opts.memberId === undefined
			? subcommand === "map"
				? executingUserId
				: null
			: opts.memberId;

	const member =
		memberId === null
			? null
			: {
					id: memberId,
					toString: () => `<@${memberId}>`,
				};

	const getUser = mock((name: string, required?: boolean) => {
		if (name === "member") {
			if (member === null && required) {
				throw new Error("member required");
			}
			return member;
		}
		return null;
	});

	const getString = mock((name: string) => {
		if (name === "riot_id") return opts.riotId ?? "Faker#KR1";
		if (name === "region") return opts.region ?? null;
		return null;
	});

	const riot = {
		isAvailable: mock(() => opts.riotAvailable ?? true),
		getAccountByRiotId: mock(
			async () =>
				opts.account ?? {
					puuid: "p1",
					gameName: "Faker",
					tagLine: "KR1",
				},
		),
		ensurePlaytimeBackfill: mock(async () => undefined),
		getLolView: mock(async () => ({
			puuid: "p1",
			platform: "na1" as const,
			gameName: "Faker",
			tagLine: "KR1",
			entries: [
				{
					queueType: "RANKED_SOLO_5x5",
					tier: "GOLD",
					rank: "II",
					leaguePoints: 50,
					wins: 10,
					losses: 5,
				},
			],
			active: null,
			matches: [
				{
					metadata: { matchId: "m1", participants: ["p1"] },
					info: {
						gameCreation: 1,
						gameDuration: 1800,
						queueId: 420,
						participants: [
							{
								puuid: "p1",
								championId: 64,
								championName: "LeeSin",
								champLevel: 18,
								kills: 5,
								deaths: 2,
								assists: 10,
								win: true,
								teamId: 100,
								totalMinionsKilled: 150,
								visionScore: 20,
								goldEarned: 12000,
								item0: 0,
								item1: 0,
								item2: 0,
								item3: 0,
								item4: 0,
								item5: 0,
								item6: 0,
							},
						],
					},
				},
			],
			summoner: {
				puuid: "p1",
				profileIconId: 1,
				summonerLevel: 100,
			},
			history: [],
		})),
	};

	const defaultLink = {
		userId: memberId ?? executingUserId,
		puuid: "p1",
		platform: "na1" as const,
		gameName: "Faker",
		tagLine: "KR1",
		linkedAt: new Date(),
	};
	const linkResult = opts.link === undefined ? defaultLink : opts.link;
	const riotLinks = {
		getPrimaryByUserId: mock(async () => linkResult),
		listByUserId: mock(async () => (linkResult ? [linkResult] : [])),
		upsert: mock(async (row: unknown) => row),
	};
	const riotMatches = {
		sumTimePlayedForUser: mock(async () => 3660),
	};

	return {
		user: { id: executingUserId },
		options: {
			getSubcommand: mock(() => subcommand),
			getUser,
			getString,
		},
		client: {
			bot: {
				permissions: {
					isAdminUser: mock(() => opts.admin ?? false),
				},
				riot,
				riotLinks,
				riotMatches,
			},
		},
		reply: mock(async () => undefined),
		deferReply: mock(async () => undefined),
		editReply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

describe("Lol", () => {
	test("map rejects non-admin mapping another user", async () => {
		const interaction = buildInteraction({
			subcommand: "map",
			memberId: "other",
			admin: false,
		});
		await new Lol().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You can only map your own account (admins can map others).",
			flags: MessageFlags.Ephemeral,
		});
		expect(interaction.client.bot.riotLinks.upsert).not.toHaveBeenCalled();
	});

	test("map allows self and upserts link", async () => {
		const interaction = buildInteraction({
			subcommand: "map",
			memberId: "self",
			riotId: "Faker#KR1",
			region: "NA",
		});
		await new Lol().execute(interaction);
		expect(interaction.deferReply).toHaveBeenCalled();
		expect(interaction.client.bot.riot.getAccountByRiotId).toHaveBeenCalledWith(
			"americas",
			"Faker",
			"KR1",
		);
		expect(interaction.client.bot.riotLinks.upsert).toHaveBeenCalledWith({
			userId: "self",
			puuid: "p1",
			platform: "na1",
			gameName: "Faker",
			tagLine: "KR1",
		});
		expect(
			interaction.client.bot.riot.ensurePlaytimeBackfill,
		).toHaveBeenCalledWith({ puuid: "p1", platform: "na1" });
		expect(interaction.editReply).toHaveBeenCalled();
	});

	test("map allows admin mapping another user", async () => {
		const interaction = buildInteraction({
			subcommand: "map",
			memberId: "other",
			admin: true,
		});
		await new Lol().execute(interaction);
		expect(interaction.client.bot.riotLinks.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "other" }),
		);
	});

	test("map rejects bad riot id", async () => {
		const interaction = buildInteraction({
			subcommand: "map",
			riotId: "NoHash",
		});
		await new Lol().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Riot ID must be `GameName#TAG`.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("view unmapped replies with hint", async () => {
		const interaction = buildInteraction({
			subcommand: "view",
			link: null,
		});
		await new Lol().execute(interaction);
		const call = (interaction.reply as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		expect(call.flags).toBe(MessageFlags.Ephemeral);
		expect(call.content).toContain("/lol map");
	});

	test("view builds embed with rank, recent, and playtime", async () => {
		const interaction = buildInteraction({ subcommand: "view" });
		await new Lol().execute(interaction);
		expect(interaction.deferReply).toHaveBeenCalled();
		expect(interaction.client.bot.riotLinks.listByUserId).toHaveBeenCalledWith(
			"self",
		);
		expect(
			interaction.client.bot.riot.ensurePlaytimeBackfill,
		).toHaveBeenCalledWith({ puuid: "p1", platform: "na1" });
		expect(
			interaction.client.bot.riotMatches.sumTimePlayedForUser,
		).toHaveBeenCalledWith("self");
		const call = (interaction.editReply as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		const embedData = call.embeds[0].toJSON();
		const solo = embedData.fields?.find(
			(f: { name: string }) => f.name === "Solo/Duo",
		);
		expect(solo?.value).toContain("GOLD II");
		const recent = embedData.fields?.find(
			(f: { name: string }) => f.name === "Recent",
		);
		expect(recent?.value).toContain("LeeSin");
		expect(recent?.value).toContain("5/2/10");
		const playtime = embedData.fields?.find(
			(f: { name: string }) =>
				f.name === "Playtime (across all paired accounts)",
		);
		expect(playtime?.value).toBe("1h 1m");
	});
});
