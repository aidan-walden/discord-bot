import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import type { UserBalance } from "../../repositories/UserBalanceRepository";
import Baltop from "./baltop";

function entry(
	userId: string,
	balanceCents: number,
	totalSpentCents: number,
	totalGainedCents: number,
	unboxCount: number,
): UserBalance {
	return {
		userId,
		balanceCents,
		mostGainedCents: 0,
		mostLostCents: 0,
		totalSpentCents,
		totalGainedCents,
		unboxCount,
	};
}

function buildInteraction(top: UserBalance[]): ChatInputCommandInteraction {
	const balances = {
		getTop: mock(async () => top),
	};

	return {
		client: { bot: { balances } },
		reply: mock(async () => undefined),
	} as unknown as ChatInputCommandInteraction;
}

describe("Baltop", () => {
	test("requests the top 10 and renders a ranked embed", async () => {
		const command = new Baltop();
		const interaction = buildInteraction([
			entry("alice", 12345, 50000, 62345, 7),
			entry("bob", 678, 1000, 1678, 2),
		]);

		await command.execute(interaction);

		expect(interaction.client.bot.balances.getTop).toHaveBeenCalledWith(10);

		const reply = (interaction.reply as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		const fields = reply.embeds[0].data.fields as {
			name: string;
			value: string;
		}[];

		const [first, second] = fields;
		expect(first?.name).toBe("#1");
		expect(first?.value).toContain("<@alice>");
		expect(first?.value).toContain("$123.45");
		expect(first?.value).toContain("Spent: $500.00");
		expect(first?.value).toContain("Gained: $623.45");
		expect(first?.value).toContain("Unboxes: 7");
		expect(second?.name).toBe("#2");
		expect(second?.value).toContain("<@bob>");
		expect(second?.value).toContain("$6.78");
	});

	test("replies that there are no balances when the leaderboard is empty", async () => {
		const command = new Baltop();
		const interaction = buildInteraction([]);

		await command.execute(interaction);

		const reply = (interaction.reply as ReturnType<typeof mock>).mock
			.calls[0]?.[0];
		expect(reply.content).toBe("No balances yet.");
	});
});
