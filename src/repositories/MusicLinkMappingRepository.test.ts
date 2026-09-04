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
import MusicLinkMappingRepository from "./MusicLinkMappingRepository";

const DATABASE_URL_TESTING = process.env.DATABASE_URL_TESTING;
const describeWithDb = DATABASE_URL_TESTING ? describe : describe.skip;

describeWithDb("MusicLinkMappingRepository", () => {
	const db = createDatabase(DATABASE_URL_TESTING as string);
	const repo = new MusicLinkMappingRepository(db);

	beforeAll(async () => {
		await migrateDatabase(db);
	});

	beforeEach(async () => {
		await db.execute(sql`TRUNCATE music_link_mappings`);
	});

	afterAll(async () => {
		await db.$client.close();
	});

	test("finds all opposite IDs from either platform in ascending order", async () => {
		await repo.record("spotify-2", "apple-2");
		await repo.record("spotify-1", "apple-2");
		await repo.record("spotify-1", "apple-1");

		expect(await repo.findOtherIds("spotify", "spotify-1")).toEqual([
			"apple-1",
			"apple-2",
		]);
		expect(await repo.findOtherIds("apple", "apple-2")).toEqual([
			"spotify-1",
			"spotify-2",
		]);
	});

	test("limits both lookup directions after ordering", async () => {
		for (const suffix of ["07", "01", "06", "00", "05", "03", "04", "02"]) {
			await repo.record("spotify-forward", `apple-${suffix}`);
			await repo.record(`spotify-${suffix}`, "apple-reverse");
		}

		expect(await repo.findOtherIds("spotify", "spotify-forward")).toEqual([
			"apple-00",
			"apple-01",
			"apple-02",
			"apple-03",
			"apple-04",
		]);
		expect(await repo.findOtherIds("apple", "apple-reverse")).toEqual([
			"spotify-00",
			"spotify-01",
			"spotify-02",
			"spotify-03",
			"spotify-04",
		]);
	});

	test("returns an empty list for an unknown ID", async () => {
		expect(await repo.findOtherIds("spotify", "missing")).toEqual([]);
		expect(await repo.findOtherIds("apple", "missing")).toEqual([]);
	});

	test("records each pair idempotently", async () => {
		await repo.record("spotify-1", "apple-1");
		await repo.record("spotify-1", "apple-1");

		expect(await repo.findOtherIds("spotify", "spotify-1")).toEqual([
			"apple-1",
		]);
	});
});
