import { describe, expect, mock, test } from "bun:test";
import { type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import Bal from "./bal";

function buildInteraction(
	targetUser: TestUser | null,
	balanceCents: number | null,
): ChatInputCommandInteraction {
	const executingUser = buildUser("executing-user", "<@executing-user>");
	const balances = {
		getByUserId: mock(async () =>
			balanceCents === null
				? null
				: {
						userId: targetUser?.id ?? executingUser.id,
						balanceCents,
						mostGainedCents: 0,
						mostLostCents: 0,
					},
		),
	};

	return {
		user: executingUser,
		options: {
			getUser: mock(() => targetUser),
		},
		client: {
			bot: {
				balances,
			},
		},
		reply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

type TestUser = {
	id: string;
	toString(): string;
};

function buildUser(id: string, mention: string): TestUser {
	return {
		id,
		toString: () => mention,
	};
}

describe("Bal", () => {
	test("uses the executing user when no user option is provided", async () => {
		const command = new Bal();
		const interaction = buildInteraction(null, 12345);

		await command.execute(interaction);

		expect(interaction.client.bot.balances.getByUserId).toHaveBeenCalledWith(
			"executing-user",
		);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Your balance: $123.45",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("uses the target user's mention when a user option is provided", async () => {
		const command = new Bal();
		const interaction = buildInteraction(
			buildUser("target-user", "<@target-user>"),
			678,
		);

		await command.execute(interaction);

		expect(interaction.client.bot.balances.getByUserId).toHaveBeenCalledWith(
			"target-user",
		);
		expect(interaction.reply).toHaveBeenCalledWith({
			content: "<@target-user>'s balance: $6.78",
			flags: MessageFlags.Ephemeral,
		});
	});

	test("displays zero when the target has no balance row", async () => {
		const command = new Bal();
		const interaction = buildInteraction(null, null);

		await command.execute(interaction);

		expect(interaction.reply).toHaveBeenCalledWith({
			content: "Your balance: $0.00",
			flags: MessageFlags.Ephemeral,
		});
	});
});
