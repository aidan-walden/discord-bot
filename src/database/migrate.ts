import path from "node:path";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { Database } from "./client";

export async function migrateDatabase(db: Database): Promise<void> {
	await migrate(db, {
		migrationsFolder: path.join(import.meta.dirname, "../../drizzle"),
	});
}
