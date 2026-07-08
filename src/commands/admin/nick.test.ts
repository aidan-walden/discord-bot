import { describe, expect, mock, test } from "bun:test";
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import Nick from "./nick";

function buildInteraction(options: {
	admin?: boolean;
	inGuild?: boolean;
	hasMe?: boolean;
	nickname?: string;
	setNicknameError?: Error;
}): ChatInputCommandInteraction {
	const nickname = options.nickname ?? "New Nickname";
	const setNickname = mock(async () => {
		if (options.setNicknameError) {
			throw options.setNicknameError;
		}
		return undefined;
	});

	const me = options.hasMe === false ? null : { setNickname };

	return {
		user: { id: "u1" },
		inGuild: () => options.inGuild ?? true,
		guild:
			options.inGuild === false
				? null
				: {
						members: { me },
					},
		options: {
			getString: mock(() => nickname),
		},
		client: {
			bot: {
				permissions: { isAdminUser: mock(() => options.admin ?? true) },
			},
		},
		reply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

describe("Nick", () => {
	test("rejects non-admins", async () => {
		const interaction = buildInteraction({ admin: false });

		await new Nick().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You don't have permission to use this command.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects when not in a guild", async () => {
		const interaction = buildInteraction({ inGuild: false });

		await new Nick().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You can't use that command here.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects when the bot's member data isn't available", async () => {
		const interaction = buildInteraction({ hasMe: false });

		await new Nick().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Couldn't find my member data in this server.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("sets the nickname and replies ephemeral on success", async () => {
		const interaction = buildInteraction({ nickname: "Cool Bot" });

		await new Nick().execute(interaction);

		expect(interaction.guild?.members.me?.setNickname).toHaveBeenCalledWith(
			"Cool Bot",
		);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Nickname changed to Cool Bot.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("replies ephemeral with an error when setNickname fails", async () => {
		const interaction = buildInteraction({
			setNicknameError: new Error("Missing Permissions"),
		});

		await new Nick().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Failed to change my nickname. Do I have Manage Nicknames?",
			flags: MessageFlags.Ephemeral,
		});
	});
});
