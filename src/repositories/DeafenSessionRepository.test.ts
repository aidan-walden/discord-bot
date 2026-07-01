import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import DeafenSessionRepository from "./DeafenSessionRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("DeafenSessionRepository", () => {
	const sql = new Bun.SQL(DATABASE_URL_TESTING as string);

	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE deafen_sessions, deafen_summaries`;
	});

	afterAll(async () => {
		await sql.close();
	});

	test("recordSession inserts a session row with the computed duration", async () => {
		const repo = new DeafenSessionRepository(sql);
		const startedAt = new Date("2026-01-01T00:00:00.000Z");
		const endedAt = new Date("2026-01-01T00:02:00.000Z");

		await repo.recordSession("user-1", "guild-1", startedAt, endedAt);

		const sessions = await repo.listSessions("user-1", "guild-1", 10);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.durationSeconds).toBe(120);
		expect(sessions[0]?.startedAt.toISOString()).toBe(startedAt.toISOString());
		expect(sessions[0]?.endedAt.toISOString()).toBe(endedAt.toISOString());
	});

	test("recordSession creates a summary with longest and count", async () => {
		const repo = new DeafenSessionRepository(sql);
		const summary = await repo.recordSession(
			"user-1",
			"guild-1",
			new Date("2026-01-01T00:00:00.000Z"),
			new Date("2026-01-01T00:01:00.000Z"),
		);

		expect(summary).toEqual({
			userId: "user-1",
			guildId: "guild-1",
			longestDeafenSeconds: 60,
			totalDeafenSeconds: 60,
			sessionCount: 1,
		});
	});

	test("longest only rises; totals and count accumulate", async () => {
		const repo = new DeafenSessionRepository(sql);
		const base = new Date("2026-01-01T00:00:00.000Z");
		const after = (seconds: number) =>
			new Date(base.getTime() + seconds * 1000);

		await repo.recordSession("user-1", "guild-1", base, after(60));
		await repo.recordSession("user-1", "guild-1", after(100), after(400)); // 300s
		const summary = await repo.recordSession(
			"user-1",
			"guild-1",
			after(500),
			after(530),
		); // 30s, shorter

		expect(summary).toEqual({
			userId: "user-1",
			guildId: "guild-1",
			longestDeafenSeconds: 300,
			totalDeafenSeconds: 390,
			sessionCount: 3,
		});
	});

	test("summaries are tracked independently per guild", async () => {
		const repo = new DeafenSessionRepository(sql);
		const base = new Date("2026-01-01T00:00:00.000Z");
		const after = (seconds: number) =>
			new Date(base.getTime() + seconds * 1000);

		await repo.recordSession("user-1", "guild-1", base, after(60));
		await repo.recordSession("user-1", "guild-2", base, after(200));

		expect(
			(await repo.getSummary("user-1", "guild-1"))?.longestDeafenSeconds,
		).toBe(60);
		expect(
			(await repo.getSummary("user-1", "guild-2"))?.longestDeafenSeconds,
		).toBe(200);
	});

	test("zero-length stretches are skipped", async () => {
		const repo = new DeafenSessionRepository(sql);
		const at = new Date("2026-01-01T00:00:00.000Z");

		const summary = await repo.recordSession("user-1", "guild-1", at, at);

		expect(summary).toBeNull();
		expect(await repo.listSessions("user-1", "guild-1", 10)).toHaveLength(0);
		expect(await repo.getSummary("user-1", "guild-1")).toBeNull();
	});

	test("listSessions returns newest first", async () => {
		const repo = new DeafenSessionRepository(sql);
		const base = new Date("2026-01-01T00:00:00.000Z");
		const after = (seconds: number) =>
			new Date(base.getTime() + seconds * 1000);

		await repo.recordSession("user-1", "guild-1", base, after(30));
		await repo.recordSession("user-1", "guild-1", after(100), after(160));

		const sessions = await repo.listSessions("user-1", "guild-1", 10);
		expect(sessions).toHaveLength(2);
		expect(sessions[0]?.startedAt.toISOString()).toBe(after(100).toISOString());
		expect(sessions[1]?.startedAt.toISOString()).toBe(base.toISOString());
	});

	test("getSummary returns null when absent", async () => {
		const repo = new DeafenSessionRepository(sql);
		expect(await repo.getSummary("nobody", "guild-1")).toBeNull();
	});
});
