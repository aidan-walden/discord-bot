import { describe, expect, mock, test } from "bun:test";
import type BanRepository from "../repositories/BanRepository";
import PermissionService from "./PermissionService";

function createBanRepository(hasResult: boolean): BanRepository {
	return {
		has: mock(async () => hasResult),
		add: mock(async () => undefined),
		remove: mock(async () => undefined),
		list: mock(async () => []),
	} as unknown as BanRepository;
}

describe("PermissionService", () => {
	test("isAdminUser() delegates to configured admin ids", () => {
		const service = new PermissionService(
			new Set(["admin-1"]),
			createBanRepository(false),
			createBanRepository(false),
			createBanRepository(false),
		);

		expect(service.isAdminUser("admin-1")).toBe(true);
		expect(service.isAdminUser("user-1")).toBe(false);
	});

	test("getMusicUsageBlockReason() prioritizes user bans over guild bans", async () => {
		const service = new PermissionService(
			new Set(),
			createBanRepository(false),
			createBanRepository(true),
			createBanRepository(true),
		);

		expect(service.getMusicUsageBlockReason("user-1", "guild-1")).resolves.toBe(
			"You're banned from using music commands.",
		);
	});

	test("getMusicUsageBlockReason() returns guild ban message", async () => {
		const service = new PermissionService(
			new Set(),
			createBanRepository(false),
			createBanRepository(false),
			createBanRepository(true),
		);

		expect(service.getMusicUsageBlockReason("user-1", "guild-1")).resolves.toBe(
			"This server is banned from using music commands. If you move servers, music bot will work normally there.",
		);
	});

	test("getMusicUsageBlockReason() returns null when unblocked", async () => {
		const service = new PermissionService(
			new Set(),
			createBanRepository(false),
			createBanRepository(false),
			createBanRepository(false),
		);

		expect(
			service.getMusicUsageBlockReason("user-1", "guild-1"),
		).resolves.toBeNull();
	});

	test("isGptUserBanned() delegates to gpt ban repository", async () => {
		const gptUserBans = createBanRepository(true);
		const service = new PermissionService(
			new Set(),
			gptUserBans,
			createBanRepository(false),
			createBanRepository(false),
		);

		expect(service.isGptUserBanned("user-1")).resolves.toBe(true);
		expect(gptUserBans.has).toHaveBeenCalledWith("user-1");
	});
});
