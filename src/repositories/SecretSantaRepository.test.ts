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
import SecretSantaRepository, {
	type SecretSantaDraw,
} from "./SecretSantaRepository";

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

	async function version(name: string): Promise<SecretSantaDraw> {
		const draw = await repo.get(name);
		if (!draw) throw new Error(`missing draw ${name}`);
		return draw;
	}

	afterAll(async () => {
		await db.$client.close();
	});

	test("create with defaults and list", async () => {
		const created = await repo.create("work-2026");
		expect(created).toMatchObject({
			name: "work-2026",
			open: true,
			spendLimitCents: null,
			drawnAt: null,
			revision: 0,
		});

		expect(await repo.list()).toHaveLength(1);
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
		const before = await version("y");
		const result = await repo.finalizeAssignments("y", before, false, (users) =>
			pairs(users),
		);

		const draw = await repo.get("y");
		expect(result.status).toBe("committed");
		expect(draw?.drawnAt).not.toBeNull();
		expect(draw?.revision).toBe(before.revision + 1);
		expect(await repo.listAssignments("y")).toEqual([
			{ giverId: "a", recipientId: "b" },
			{ giverId: "b", recipientId: "a" },
		]);
		expect(await repo.addParticipant("y", "c")).toBe("locked");
		expect(await repo.removeParticipant("y", "a")).toBe("locked");

		await repo.delete("y");
		expect(await repo.listAssignments("y")).toEqual([]);
	});

	test("changes after preview make finalization stale", async () => {
		const changes: [string, () => Promise<unknown>][] = [
			["opt-in", () => repo.addParticipant("fresh", "c")],
			["opt-out", () => repo.removeParticipant("fresh", "b")],
			["exclusion", () => repo.addExclusions("fresh", ["a", "b"])],
			["spend limit", () => repo.setSpendLimitCents("fresh", 2500)],
			[
				"recreate",
				async () => {
					await repo.delete("fresh");
					await repo.create("fresh");
					await repo.addParticipant("fresh", "a");
					await repo.addParticipant("fresh", "b");
				},
			],
		];
		for (const [label, change] of changes) {
			await repo.delete("fresh");
			await repo.create("fresh");
			await repo.addParticipant("fresh", "a");
			await repo.addParticipant("fresh", "b");
			const preview = await version("fresh");
			await change();

			const result = await repo.finalizeAssignments(
				"fresh",
				preview,
				false,
				(current) => pairs(current),
			);
			expect({ label, status: result.status }).toEqual({
				label,
				status: "stale",
			});
			expect(await repo.listAssignments("fresh")).toEqual([]);
		}
	});

	test("no-op roster and exclusion changes keep the revision", async () => {
		await repo.create("same");
		await repo.addParticipant("same", "a");
		await repo.addExclusions("same", ["a", "b"]);
		const before = await version("same");

		await repo.addParticipant("same", "a");
		await repo.removeParticipant("same", "b");
		await repo.addExclusions("same", ["b", "a"]);
		expect((await version("same")).revision).toBe(before.revision);
	});

	test("only one concurrent draw and reroll commits per revision", async () => {
		await repo.create("race");
		for (const userId of ["a", "b", "c"]) {
			await repo.addParticipant("race", userId);
		}

		const preview = await version("race");
		const draws = await Promise.all([
			repo.finalizeAssignments("race", preview, false, (users) =>
				pairs(users, 1),
			),
			repo.finalizeAssignments("race", preview, false, (users) =>
				pairs(users, 2),
			),
		]);
		expect(draws.map((result) => result.status).sort()).toEqual([
			"committed",
			"stale",
		]);
		const drawWinner = draws.find((result) => result.status === "committed");
		expect(await repo.listAssignments("race")).toEqual(
			drawWinner?.status === "committed" ? drawWinner.pairs : [],
		);

		const drawn = await version("race");
		const rerolls = await Promise.all([
			repo.finalizeAssignments("race", drawn, true, (users) => pairs(users, 1)),
			repo.finalizeAssignments("race", drawn, true, (users) => pairs(users, 2)),
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
		expect((await repo.get("race"))?.revision).toBe(drawn.revision + 1);
	});

	test("impossible reroll preserves assignments and revision", async () => {
		await repo.create("keep");
		await repo.addParticipant("keep", "a");
		await repo.addParticipant("keep", "b");
		await repo.finalizeAssignments(
			"keep",
			await version("keep"),
			false,
			(users) => pairs(users),
		);
		const drawn = await version("keep");
		const before = await repo.listAssignments("keep");

		expect(
			await repo.finalizeAssignments("keep", drawn, true, () => null),
		).toEqual({ status: "impossible" });
		expect(await repo.listAssignments("keep")).toEqual(before);
		expect((await repo.get("keep"))?.revision).toBe(drawn.revision);
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
