import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../database/client";
import { migrateDatabase } from "../database/migrate";
import SecretSantaRepository from "./SecretSantaRepository";

function pairs(participants: string[], shift = 1) {
	return participants.map((giverId, index) => ({
		giverId,
		recipientId: participants[(index + shift) % participants.length] as string,
	}));
}

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("SecretSantaRepository", () => {
	const db = createDatabase(DATABASE_URL_TESTING as string);
	const repo = new SecretSantaRepository(db);

	beforeAll(async () => {
		await migrateDatabase(db);
	});

	beforeEach(async () => {
		await db.execute(sql`TRUNCATE secret_santa_draws CASCADE`);
	});

	afterAll(async () => {
		await db.$client.close();
	});

	test("create get list delete", async () => {
		const created = await repo.create("work-2026");
		expect(created).toMatchObject({
			name: "work-2026",
			open: true,
			spendLimitCents: null,
			drawnAt: null,
			revision: 0,
		});

		expect(await repo.get("work-2026")).toMatchObject({ name: "work-2026" });
		expect(await repo.list()).toHaveLength(1);
		expect(await repo.delete("work-2026")).toBe(true);
		expect(await repo.get("work-2026")).toBeNull();
	});

	test("participants and exclusions", async () => {
		await repo.create("x");
		expect(await repo.addParticipant("x", "u2")).toBe("added");
		expect(await repo.addParticipant("x", "u1")).toBe("added");
		expect(await repo.addParticipant("x", "u1")).toBe("already-present");
		expect(await repo.listParticipants("x")).toEqual(["u1", "u2"]);

		expect(await repo.addExclusions("x", ["u2", "u1", "u3"])).toBe(3);
		expect(await repo.listExclusions("x")).toEqual([
			{ userA: "u1", userB: "u2" },
			{ userA: "u1", userB: "u3" },
			{ userA: "u2", userB: "u3" },
		]);
		expect(await repo.addExclusions("x", ["u1", "u2"])).toBe(0);

		expect(await repo.removeParticipant("x", "u1")).toBe("removed");
		expect(await repo.listParticipants("x")).toEqual(["u2"]);
	});

	test("finalizes assignments and locks the roster", async () => {
		await repo.create("y");
		await repo.addParticipant("y", "a");
		await repo.addParticipant("y", "b");
		const result = await repo.finalizeAssignments("y", 0, false, (users) =>
			pairs(users),
		);

		const draw = await repo.get("y");
		expect(result.status).toBe("committed");
		expect(draw?.drawnAt).not.toBeNull();
		expect(draw?.revision).toBe(1);
		expect(await repo.listAssignments("y")).toEqual([
			{ giverId: "a", recipientId: "b" },
			{ giverId: "b", recipientId: "a" },
		]);
		expect(await repo.addParticipant("y", "c")).toBe("locked");
		expect(await repo.removeParticipant("y", "a")).toBe("locked");

		await repo.delete("y");
		expect(await repo.listAssignments("y")).toEqual([]);
	});

	test("finalization reloads the roster after preview", async () => {
		await repo.create("fresh");
		await repo.addParticipant("fresh", "a");
		await repo.addParticipant("fresh", "b");
		expect(await repo.listParticipants("fresh")).toEqual(["a", "b"]);
		await repo.addParticipant("fresh", "c");

		const result = await repo.finalizeAssignments(
			"fresh",
			0,
			false,
			(current) => pairs(current),
		);
		expect(result.status).toBe("committed");
		expect(await repo.listAssignments("fresh")).toHaveLength(3);
	});

	test("only one concurrent draw and reroll commits per revision", async () => {
		await repo.create("race");
		for (const userId of ["a", "b", "c"]) {
			await repo.addParticipant("race", userId);
		}

		const draws = await Promise.all([
			repo.finalizeAssignments("race", 0, false, (users) => pairs(users, 1)),
			repo.finalizeAssignments("race", 0, false, (users) => pairs(users, 2)),
		]);
		expect(draws.map((result) => result.status).sort()).toEqual([
			"committed",
			"stale",
		]);
		const drawWinner = draws.find((result) => result.status === "committed");
		expect(await repo.listAssignments("race")).toEqual(
			drawWinner?.status === "committed" ? drawWinner.pairs : [],
		);

		const rerolls = await Promise.all([
			repo.finalizeAssignments("race", 1, true, (users) => pairs(users, 1)),
			repo.finalizeAssignments("race", 1, true, (users) => pairs(users, 2)),
		]);
		expect(rerolls.map((result) => result.status).sort()).toEqual([
			"committed",
			"stale",
		]);
		const rerollWinner = rerolls.find(
			(result) => result.status === "committed",
		);
		expect(await repo.listAssignments("race")).toEqual(
			rerollWinner?.status === "committed" ? rerollWinner.pairs : [],
		);
		expect((await repo.get("race"))?.revision).toBe(2);
	});

	test("impossible reroll preserves assignments and revision", async () => {
		await repo.create("keep");
		await repo.addParticipant("keep", "a");
		await repo.addParticipant("keep", "b");
		await repo.finalizeAssignments("keep", 0, false, (users) => pairs(users));
		const before = await repo.listAssignments("keep");

		expect(await repo.finalizeAssignments("keep", 1, true, () => null)).toEqual(
			{ status: "impossible" },
		);
		expect(await repo.listAssignments("keep")).toEqual(before);
		expect((await repo.get("keep"))?.revision).toBe(1);
	});

	test("setOpen and setSpendLimitCents", async () => {
		await repo.create("z");
		expect(await repo.addParticipant("missing", "u1")).toBe("missing");
		expect((await repo.setOpen("z", false))?.open).toBe(false);
		expect(await repo.addParticipant("z", "u1")).toBe("closed");
		expect((await repo.setSpendLimitCents("z", 2500))?.spendLimitCents).toBe(
			2500,
		);
		expect((await repo.setSpendLimitCents("z", null))?.spendLimitCents).toBe(
			null,
		);
	});
});
