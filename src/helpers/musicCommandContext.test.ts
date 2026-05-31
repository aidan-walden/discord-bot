import { describe, expect, mock, test } from "bun:test";
import {
	type ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
} from "discord.js";
import type { KazagumoPlayer } from "kazagumo";
import { getMusicCommandContext } from "./musicCommandContext";

type InteractionOptions = {
	guildId?: string | null;
	member?: GuildMember | unknown;
	userId?: string;
	usageBlockReason?: string | null;
	voiceChannelId?: string | null;
	player?: KazagumoPlayer;
};

function createGuildMember(voiceChannelId: string | null = "voice-123") {
	const member = {
		voice: {
			channelId: voiceChannelId,
		},
	};

	Object.setPrototypeOf(member, GuildMember.prototype);
	return member as GuildMember;
}

function createInteraction(options: InteractionOptions = {}) {
	const {
		guildId = "guild-123",
		member = createGuildMember(
			"voiceChannelId" in options ? options.voiceChannelId : "voice-123",
		),
		userId = "user-123",
		usageBlockReason = null,
		player,
	} = options;

	const reply = mock(async () => undefined);
	const getMusicUsageBlockReason = mock(async () => usageBlockReason);
	const getPlayer = mock(() => player);
	const interaction = {
		guildId,
		member,
		user: {
			id: userId,
		},
		client: {
			bot: {
				permissions: {
					getMusicUsageBlockReason,
				},
				music: {
					getPlayer,
				},
			},
		},
		reply,
	} as unknown as ChatInputCommandInteraction;

	return {
		interaction,
		reply,
		getMusicUsageBlockReason,
		getPlayer,
		member,
	};
}

function expectEphemeralReply(reply: ReturnType<typeof mock>, content: string) {
	expect(reply).toHaveBeenCalledWith({
		content,
		flags: MessageFlags.Ephemeral,
	});
}

describe("getMusicCommandContext", () => {
	test("rejects commands outside guilds", async () => {
		const { interaction, reply, getMusicUsageBlockReason } = createInteraction({
			guildId: null,
		});

		expect(getMusicCommandContext(interaction)).resolves.toBeNull();

		expectEphemeralReply(reply, "This command can only be used in a guild");
		expect(getMusicUsageBlockReason).not.toHaveBeenCalled();
	});

	test("rejects commands from non-members", async () => {
		const { interaction, reply, getMusicUsageBlockReason } = createInteraction({
			member: {
				voice: {
					channelId: "voice-123",
				},
			},
		});

		expect(getMusicCommandContext(interaction)).resolves.toBeNull();

		expectEphemeralReply(reply, "This command can only be used by a member");
		expect(getMusicUsageBlockReason).not.toHaveBeenCalled();
	});

	const usageBlockCases = [
		{
			name: "rejects banned users",
			reason: "You're banned from using music commands.",
		},
		{
			name: "rejects banned servers",
			reason:
				"This server is banned from using music commands. If you move servers, music bot will work normally there.",
		},
	] as const;

	for (const { name, reason } of usageBlockCases) {
		test(name, async () => {
			const { interaction, reply, getMusicUsageBlockReason } =
				createInteraction({
					usageBlockReason: reason,
				});

			expect(getMusicCommandContext(interaction)).resolves.toBeNull();

			expect(getMusicUsageBlockReason).toHaveBeenCalledWith(
				"user-123",
				"guild-123",
			);
			expectEphemeralReply(reply, reason);
		});
	}

	test("rejects missing voice channel when required", async () => {
		const { interaction, reply } = createInteraction({
			voiceChannelId: null,
		});

		expect(
			getMusicCommandContext(interaction, { requireVoiceChannel: true }),
		).resolves.toBeNull();

		expectEphemeralReply(
			reply,
			"You must be in a voice channel to use this command",
		);
	});

	test("rejects missing player when required", async () => {
		const { interaction, reply, getPlayer } = createInteraction({
			player: undefined,
		});

		expect(
			getMusicCommandContext(interaction, { requirePlayer: true }),
		).resolves.toBeNull();

		expect(getPlayer).toHaveBeenCalledWith("guild-123");
		expectEphemeralReply(reply, "There is nothing playing");
	});

	test("returns guild, member, voice channel, and player on success", async () => {
		const player = { queue: [] } as unknown as KazagumoPlayer;
		const member = createGuildMember();
		const { interaction, reply, getPlayer } = createInteraction({
			member,
			player,
		});

		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});

		expect(context).toEqual({
			guildId: "guild-123",
			member,
			voiceChannelId: "voice-123",
			player,
		});
		expect(getPlayer).toHaveBeenCalledWith("guild-123");
		expect(reply).not.toHaveBeenCalled();
	});
});
