import { describe, expect, mock, test } from "bun:test";
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import Echo from "./echo";

function buildInteraction(options: {
	admin?: boolean;
	sendable?: boolean;
	msg?: string;
	sendError?: Error;
}): ChatInputCommandInteraction {
	const msg = options.msg ?? "Hello, world!";
	const send = mock(async () => {
		if (options.sendError) {
			throw options.sendError;
		}
		return undefined;
	});

	return {
		user: { id: "u1" },
		channel: {
			isSendable: () => options.sendable ?? true,
			send,
		},
		options: {
			getString: mock(() => msg),
		},
		client: {
			bot: {
				permissions: { isAdminUser: mock(() => options.admin ?? true) },
			},
		},
		reply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

describe("Echo", () => {
	test("rejects non-admins", async () => {
		const interaction = buildInteraction({ admin: false });

		await new Echo().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "You don't have permission to use this command.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("rejects when the channel isn't sendable", async () => {
		const interaction = buildInteraction({ sendable: false });

		await new Echo().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Failed to send the message: this channel is not sendable.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("sends the message and replies ephemeral on success", async () => {
		const interaction = buildInteraction({ msg: "Hi there" });

		await new Echo().execute(interaction);

		expect(interaction.channel?.send).toHaveBeenCalledWith("Hi there");
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Message sent.",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("replies ephemeral with an error when sending fails", async () => {
		const interaction = buildInteraction({
			sendError: new Error("Missing Permissions"),
		});

		await new Echo().execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content:
				"Failed to send the message: an error occurred, details in console.",
			flags: MessageFlags.Ephemeral,
		});
	});
});
