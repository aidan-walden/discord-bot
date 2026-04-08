import { beforeEach, describe, expect, mock, test } from "bun:test";
import BanRepository from "./BanRepository";

const mockSql = mock((_strings: TemplateStringsArray, ..._values: unknown[]) =>
	Promise.resolve<unknown[]>([]),
);
const mockUnsafe = mock((identifier: string) => identifier);

const sql = Object.assign(mockSql, {
	unsafe: mockUnsafe,
}) as unknown as typeof Bun.sql;

describe("BanRepository", () => {
	beforeEach(() => {
		mockSql.mockReset();
		mockSql.mockImplementation(
			(_strings: TemplateStringsArray, ..._values: unknown[]) =>
				Promise.resolve<unknown[]>([]),
		);

		mockUnsafe.mockReset();
		mockUnsafe.mockImplementation((identifier: string) => identifier);
	});

	test("has() returns true when a record exists", async () => {
		mockSql.mockResolvedValueOnce([{ user_id: "user-123" }]);

		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		const result = await repo.has("user-123");

		expect(result).toBe(true);
		expect(mockSql).toHaveBeenCalledTimes(1);
		expect(mockUnsafe).toHaveBeenCalledWith("gpt_user_bans");
		expect(mockUnsafe).toHaveBeenCalledWith("user_id");
		expect(mockSql.mock.calls[0]?.slice(1)).toEqual([
			"gpt_user_bans",
			"user_id",
			"user-123",
		]);
	});

	test("has() returns false when no record exists", async () => {
		mockSql.mockResolvedValueOnce([]);

		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");
		const result = await repo.has("user-123");

		expect(result).toBe(false);
		expect(mockSql).toHaveBeenCalledTimes(1);
		expect(mockUnsafe).toHaveBeenCalledWith("gpt_user_bans");
		expect(mockUnsafe).toHaveBeenCalledWith("user_id");
		expect(mockSql.mock.calls[0]?.slice(1)).toEqual([
			"gpt_user_bans",
			"user_id",
			"user-123",
		]);
	});

	test("add() inserts into a user ban table with the configured column", async () => {
		const repo = new BanRepository(sql, "gpt_user_bans", "user_id");

		await repo.add("user-123");

		expect(mockSql).toHaveBeenCalledTimes(1);
		expect(mockUnsafe.mock.calls).toEqual([
			["gpt_user_bans"],
			["user_id"],
			["user_id"],
		]);
		expect(mockSql.mock.calls[0]?.slice(1)).toEqual([
			"gpt_user_bans",
			"user_id",
			"user-123",
			"user_id",
		]);
	});

	test("remove() deletes from a guild ban table with the configured column", async () => {
		const repo = new BanRepository(sql, "music_guild_bans", "guild_id");

		await repo.remove("guild-123");

		expect(mockSql).toHaveBeenCalledTimes(1);
		expect(mockUnsafe.mock.calls).toEqual([["music_guild_bans"], ["guild_id"]]);
		expect(mockSql.mock.calls[0]?.slice(1)).toEqual([
			"music_guild_bans",
			"guild_id",
			"guild-123",
		]);
	});

	test("list() maps rows to string ids using the configured column", async () => {
		mockSql.mockResolvedValueOnce([
			{ value: "guild-123" },
			{ value: "guild-456" },
		]);

		const repo = new BanRepository(sql, "music_guild_bans", "guild_id");
		const result = await repo.list();

		expect(result).toEqual(["guild-123", "guild-456"]);
		expect(mockSql).toHaveBeenCalledTimes(1);
		expect(mockUnsafe.mock.calls).toEqual([
			["guild_id"],
			["music_guild_bans"],
			["guild_id"],
		]);
		expect(mockSql.mock.calls[0]?.slice(1)).toEqual([
			"guild_id",
			"music_guild_bans",
			"guild_id",
		]);
	});
});
