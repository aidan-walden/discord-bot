import { describe, expect, mock, test } from "bun:test";
import {
	type ChatInputCommandInteraction,
	type Guild,
	GuildMember,
	MessageFlags,
	type ModalSubmitInteraction,
} from "discord.js";
import Admin, { ACTIONS_BY_ID, buildPanel, ROWS, snowflake } from "./admin";

type Bot = ChatInputCommandInteraction["client"]["bot"];

const VALID_ID = "123456789012345678";

function getAction(id: string) {
	const action = ACTIONS_BY_ID.get(id);
	if (!action) {
		throw new Error(`missing action ${id}`);
	}
	return action;
}

function createBot() {
	const make = () => ({
		add: mock(async () => undefined),
		remove: mock(async () => undefined),
	});
	return {
		permissions: {
			isAdminUser: mock(() => true),
			gptUserBans: make(),
			musicUserBans: make(),
			musicGuildBans: make(),
		},
		guildSettings: {
			setMainChannel: mock(async () => undefined),
		},
	} as unknown as Bot;
}

describe("snowflake", () => {
	test("accepts and trims a valid id", () => {
		expect(snowflake(`  ${VALID_ID}  `, "user ID")).toBe(VALID_ID);
	});

	test.each([["abc"], ["12345"], ["1".repeat(21)], [undefined], [""]])(
		"rejects %p",
		(value) => {
			expect(() => snowflake(value as string | undefined, "user ID")).toThrow(
				"is not a valid user ID",
			);
		},
	);
});

describe("ACTIONS run()", () => {
	test("kick_voice disconnects a member in a voice channel", async () => {
		const disconnect = mock(async () => undefined);
		const guild = {
			members: {
				fetch: mock(async () => ({ voice: { channel: {}, disconnect } })),
			},
		} as unknown as Guild;

		const result = await getAction("kick_voice").run(
			{ user_id: VALID_ID },
			{ bot: createBot(), guild, modal: {} as ModalSubmitInteraction },
		);

		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(result).toContain(`Kicked <@${VALID_ID}>`);
	});

	test("kick_voice throws when the member is not in voice", async () => {
		const guild = {
			members: { fetch: mock(async () => ({ voice: { channel: null } })) },
		} as unknown as Guild;

		await expect(
			getAction("kick_voice").run(
				{ user_id: VALID_ID },
				{ bot: createBot(), guild, modal: {} as ModalSubmitInteraction },
			),
		).rejects.toThrow("is not in a voice channel");
	});

	test("kick_voice rejects a bad snowflake", async () => {
		await expect(
			getAction("kick_voice").run(
				{ user_id: "nope" },
				{
					bot: createBot(),
					guild: {} as Guild,
					modal: {} as ModalSubmitInteraction,
				},
			),
		).rejects.toThrow("is not a valid user ID");
	});

	test("delete_message deletes from a text channel", async () => {
		const del = mock(async () => undefined);
		const modal = {
			channel: {
				isTextBased: () => true,
				isDMBased: () => false,
				messages: { delete: del },
			},
		} as unknown as ModalSubmitInteraction;

		const result = await getAction("delete_message").run(
			{ message_id: VALID_ID },
			{ bot: createBot(), guild: {} as Guild, modal },
		);

		expect(del).toHaveBeenCalledWith(VALID_ID);
		expect(result).toContain("Deleted message");
	});

	test("delete_message throws in a DM channel", async () => {
		const modal = {
			channel: { isTextBased: () => true, isDMBased: () => true },
		} as unknown as ModalSubmitInteraction;

		await expect(
			getAction("delete_message").run(
				{ message_id: VALID_ID },
				{ bot: createBot(), guild: {} as Guild, modal },
			),
		).rejects.toThrow("Can't delete messages in this channel");
	});

	test("change_nick sets a member's nickname", async () => {
		const setNickname = mock(async () => undefined);
		const guild = {
			members: { fetch: mock(async () => ({ setNickname })) },
		} as unknown as Guild;

		const result = await getAction("change_nick").run(
			{ user_id: VALID_ID, nickname: "Cooler" },
			{ bot: createBot(), guild, modal: {} as ModalSubmitInteraction },
		);

		expect(setNickname).toHaveBeenCalledWith("Cooler");
		expect(result).toContain("**Cooler**");
	});

	test.each([
		["ban_gpt", "gptUserBans", "add"],
		["pardon_gpt", "gptUserBans", "remove"],
		["ban_music", "musicUserBans", "add"],
		["pardon_music", "musicUserBans", "remove"],
		["ban_guild_music", "musicGuildBans", "add"],
		["pardon_guild_music", "musicGuildBans", "remove"],
	] as const)("%s calls %s.%s", async (actionId, repo, method) => {
		const bot = createBot();
		const field = actionId.includes("guild") ? "guild_id" : "user_id";

		await getAction(actionId).run(
			{ [field]: VALID_ID },
			{ bot, guild: {} as Guild, modal: {} as ModalSubmitInteraction },
		);

		expect(bot.permissions[repo][method]).toHaveBeenCalledWith(VALID_ID);
	});

	test("set_main_channel upserts guild main channel", async () => {
		const bot = createBot();
		const channelId = "987654321098765432";
		const guild = { id: VALID_ID } as Guild;
		const modal = {
			channel: {
				id: channelId,
				isTextBased: () => true,
				isDMBased: () => false,
			},
		} as unknown as ModalSubmitInteraction;

		const result = await getAction("set_main_channel").run(
			{},
			{ bot, guild, modal },
		);

		expect(bot.guildSettings.setMainChannel).toHaveBeenCalledWith(
			VALID_ID,
			channelId,
		);
		expect(result).toContain(`<#${channelId}>`);
	});

	test("set_main_channel throws in a DM channel", async () => {
		const modal = {
			channel: { isTextBased: () => true, isDMBased: () => true },
		} as unknown as ModalSubmitInteraction;

		await expect(
			getAction("set_main_channel").run(
				{},
				{
					bot: createBot(),
					guild: { id: VALID_ID } as Guild,
					modal,
				},
			),
		).rejects.toThrow("Can't set main channel here");
	});
});

describe("buildPanel", () => {
	test("builds one row per ROWS entry", () => {
		expect(buildPanel()).toHaveLength(ROWS.length);
	});
});

describe("Admin.execute", () => {
	function createInteraction(options: {
		admin?: boolean;
		inGuild?: boolean;
		member?: unknown;
		textChannel?: boolean;
	}) {
		const reply = mock(
			async (_options: { content: string; components?: unknown[] }) => ({
				createMessageComponentCollector: mock(() => ({
					on: mock(() => undefined),
				})),
			}),
		);
		return {
			user: { id: "u1" },
			client: {
				bot: {
					permissions: { isAdminUser: mock(() => options.admin ?? true) },
				},
			},
			inGuild: () => options.inGuild ?? true,
			member: options.member ?? Object.create(GuildMember.prototype),
			channel: { isTextBased: () => options.textChannel ?? true },
			reply,
		} as unknown as ChatInputCommandInteraction & { reply: typeof reply };
	}

	test("rejects non-admins", async () => {
		const interaction = createInteraction({ admin: false });
		await new Admin().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You don't have permission to use this command.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects when not in a guild", async () => {
		const interaction = createInteraction({ inGuild: false });
		await new Admin().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You can't use that command here.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects when the member is not a GuildMember", async () => {
		const interaction = createInteraction({ member: {} });
		await new Admin().execute(interaction);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You can't use that command here.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("shows the panel on the happy path", async () => {
		const interaction = createInteraction({});
		await new Admin().execute(interaction);
		const call = interaction.reply.mock.calls[0]?.[0];
		expect(call?.components).toHaveLength(ROWS.length);
	});
});
