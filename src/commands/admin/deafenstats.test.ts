import { describe, expect, mock, test } from "bun:test";
import {
	type ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
} from "discord.js";
import type { DeafenSummary } from "../../repositories/DeafenSessionRepository";
import DeafenStats from "./deafenstats";

function buildInteraction(options: {
	admin?: boolean;
	inGuild?: boolean;
	member?: unknown;
	summary?: DeafenSummary | null;
	activeSeconds?: number | null;
}): ChatInputCommandInteraction {
	const member =
		options.member ??
		Object.defineProperties(Object.create(GuildMember.prototype), {
			id: { value: "target-member" },
			displayName: { value: "TargetMember" },
			toString: { value: () => "<@target-member>" },
		});

	const deafenSessions = {
		getSummary: mock(async () => options.summary ?? null),
	};
	const deafenTracker = {
		getActiveSessionSeconds: mock(() => options.activeSeconds ?? null),
	};

	return {
		user: { id: "u1" },
		guildId: "guild-1",
		inGuild: () => options.inGuild ?? true,
		options: {
			getMember: mock(() => member),
		},
		client: {
			bot: {
				permissions: { isAdminUser: mock(() => options.admin ?? true) },
				deafenSessions,
				deafenTracker,
			},
		},
		reply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

describe("DeafenStats", () => {
	test("rejects non-admins", async () => {
		const interaction = buildInteraction({ admin: false });

		await new DeafenStats().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You don't have permission to use this command.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects when not in a guild", async () => {
		const interaction = buildInteraction({ inGuild: false });

		await new DeafenStats().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You can't use that command here.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects when the member option isn't a GuildMember", async () => {
		const interaction = buildInteraction({ member: {} });

		await new DeafenStats().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You can't use that command here.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("replies ephemeral with no data when there's no summary or active session", async () => {
		const interaction = buildInteraction({
			summary: null,
			activeSeconds: null,
		});

		await new DeafenStats().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "No deafen data recorded for <@target-member>.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("replies with an ephemeral embed when a summary exists", async () => {
		const interaction = buildInteraction({
			summary: {
				userId: "target-member",
				guildId: "guild-1",
				longestDeafenSeconds: 3725,
				totalDeafenSeconds: 7384,
				sessionCount: 4,
			},
			activeSeconds: null,
		});

		await new DeafenStats().execute(interaction);

		expect(
			interaction.client.bot.deafenSessions.getSummary,
		).toHaveBeenCalledWith("target-member", "guild-1");
		expect(
			interaction.client.bot.deafenTracker.getActiveSessionSeconds,
		).toHaveBeenCalledWith("guild-1", "target-member");

		const call = (interaction.reply as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		expect(call.flags).toBe(MessageFlags.Ephemeral);
		expect(call.embeds).toHaveLength(1);

		const embedData = call.embeds[0].toJSON();
		expect(embedData.title).toBe("Deafen Tracker — TargetMember");
		expect(embedData.fields).toEqual([
			{ name: "Total Deafened", value: "2h 3m 4s", inline: true },
			{ name: "Longest Session", value: "1h 2m 5s", inline: true },
			{ name: "Sessions", value: "4", inline: true },
		]);
	});

	test("includes Current Session when the target is actively deafened", async () => {
		const interaction = buildInteraction({
			summary: {
				userId: "target-member",
				guildId: "guild-1",
				longestDeafenSeconds: 3725,
				totalDeafenSeconds: 7384,
				sessionCount: 4,
			},
			activeSeconds: 7200,
		});

		await new DeafenStats().execute(interaction);

		const call = (interaction.reply as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		const embedData = call.embeds[0].toJSON();
		expect(embedData.fields).toEqual([
			{ name: "Total Deafened", value: "2h 3m 4s", inline: true },
			{ name: "Longest Session", value: "1h 2m 5s", inline: true },
			{ name: "Sessions", value: "4", inline: true },
			{ name: "Current Session", value: "2h 0m 0s", inline: true },
		]);
	});

	test("shows zeros plus Current Session when only an active session exists", async () => {
		const interaction = buildInteraction({
			summary: null,
			activeSeconds: 3661,
		});

		await new DeafenStats().execute(interaction);

		const call = (interaction.reply as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		const embedData = call.embeds[0].toJSON();
		expect(embedData.fields).toEqual([
			{ name: "Total Deafened", value: "0h 0m 0s", inline: true },
			{ name: "Longest Session", value: "0h 0m 0s", inline: true },
			{ name: "Sessions", value: "0", inline: true },
			{ name: "Current Session", value: "1h 1m 1s", inline: true },
		]);
	});
});
