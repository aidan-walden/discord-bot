import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { migrateDatabase } from "../database/migrate";
import SecretSantaRepository from "./SecretSantaRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("SecretSantaRepository", () => {
	const sql = new Bun.SQL(DATABASE_URL_TESTING as string);
	const repo = new SecretSantaRepository(sql);

	beforeAll(async () => {
		await migrateDatabase(sql);
	});

	beforeEach(async () => {
		await sql`TRUNCATE secret_santa_draws CASCADE`;
	});

	afterAll(async () => {
		await sql.close();
	});

	test("create get list delete", async () => {
		const created = await repo.create("work-2026");
		expect(created).toMatchObject({
			name: "work-2026",
			open: true,
			spendLimitCents: null,
			drawnAt: null,
		});

		expect(await repo.get("work-2026")).toMatchObject({ name: "work-2026" });
		expect(await repo.list()).toHaveLength(1);
		expect(await repo.delete("work-2026")).toBe(true);
		expect(await repo.get("work-2026")).toBeNull();
	});

	test("participants and exclusions", async () => {
		await repo.create("x");
		expect(await repo.addParticipant("x", "u2")).toBe(true);
		expect(await repo.addParticipant("x", "u1")).toBe(true);
		expect(await repo.addParticipant("x", "u1")).toBe(false);
		expect(await repo.listParticipants("x")).toEqual(["u1", "u2"]);

		expect(await repo.addExclusions("x", ["u2", "u1", "u3"])).toBe(3);
		expect(await repo.listExclusions("x")).toEqual([
			{ userA: "u1", userB: "u2" },
			{ userA: "u1", userB: "u3" },
			{ userA: "u2", userB: "u3" },
		]);
		expect(await repo.addExclusions("x", ["u1", "u2"])).toBe(0);

		expect(await repo.removeParticipant("x", "u1")).toBe(true);
		expect(await repo.listParticipants("x")).toEqual(["u2"]);
	});

	test("replaceAssignments and cascade delete", async () => {
		await repo.create("y");
		await repo.addParticipant("y", "a");
		await repo.addParticipant("y", "b");
		await repo.replaceAssignments("y", [
			{ giverId: "a", recipientId: "b" },
			{ giverId: "b", recipientId: "a" },
		]);

		const draw = await repo.get("y");
		expect(draw?.drawnAt).not.toBeNull();
		expect(await repo.listAssignments("y")).toEqual([
			{ giverId: "a", recipientId: "b" },
			{ giverId: "b", recipientId: "a" },
		]);

		await repo.replaceAssignments("y", [
			{ giverId: "a", recipientId: "b" },
			{ giverId: "b", recipientId: "a" },
		]);
		expect(await repo.listAssignments("y")).toHaveLength(2);

		await repo.delete("y");
		expect(await repo.listAssignments("y")).toEqual([]);
	});

	test("setOpen and setSpendLimitCents", async () => {
		await repo.create("z");
		expect((await repo.setOpen("z", false))?.open).toBe(false);
		expect((await repo.setSpendLimitCents("z", 2500))?.spendLimitCents).toBe(
			2500,
		);
		expect((await repo.setSpendLimitCents("z", null))?.spendLimitCents).toBe(
			null,
		);
	});
});
