import { describe, expect, mock, test } from "bun:test";
import { MessageFlags } from "discord.js";
import { isAdminUser, requireAdminUser } from "./permissions";

describe("permissions helpers", () => {
	test("isAdminUser() returns membership from admin set", () => {
		const adminUserIds = new Set(["admin-1", "admin-2"]);

		expect(isAdminUser("admin-1", adminUserIds)).toBe(true);
		expect(isAdminUser("user-1", adminUserIds)).toBe(false);
	});

	test("requireAdminUser() returns true for admins without replying", async () => {
		const reply = mock(async () => undefined);
		const interaction = {
			user: { id: "admin-1" },
			reply,
		};

		expect(
			requireAdminUser(interaction as never, new Set(["admin-1"])),
		).resolves.toBe(true);
		expect(reply).not.toHaveBeenCalled();
	});

	test("requireAdminUser() replies ephemerally for non-admins", async () => {
		const reply = mock(async () => undefined);
		const interaction = {
			user: { id: "user-1" },
			reply,
		};

		expect(
			requireAdminUser(interaction as never, new Set(["admin-1"])),
		).resolves.toBe(false);
		expect(reply).toHaveBeenCalledWith({
			content: "You don't have permission to use that command.",
			flags: MessageFlags.Ephemeral,
		});
	});
});
