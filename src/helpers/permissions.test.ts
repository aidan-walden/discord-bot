import { describe, expect, mock, test } from "bun:test";
import { MessageFlags } from "discord.js";
import { requireAdminUser } from "./permissions";

function createInteraction(userId: string) {
	const reply = mock(async () => undefined);
	const interaction = {
		user: { id: userId },
		client: {
			bot: {
				permissions: {
					isAdminUser: (id: string) => id === "admin-1",
				},
			},
		},
		reply,
	};
	return { interaction, reply };
}

describe("permissions helpers", () => {
	test("requireAdminUser() returns true for admins without replying", async () => {
		const { interaction, reply } = createInteraction("admin-1");

		expect(await requireAdminUser(interaction as never)).toBe(true);
		expect(reply).not.toHaveBeenCalled();
	});

	test("requireAdminUser() replies ephemerally for non-admins", async () => {
		const { interaction, reply } = createInteraction("user-1");

		expect(await requireAdminUser(interaction as never)).toBe(false);
		expect(reply).toHaveBeenCalledWith({
			content: "You don't have permission to use this command.",
			flags: MessageFlags.Ephemeral,
		});
	});
});
