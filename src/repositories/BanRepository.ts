import { asc, eq } from "drizzle-orm";
import type { Database } from "../database/client";
import type { gptUserBans } from "../database/schema";

type BanTable = typeof gptUserBans;

export default class BanRepository {
	constructor(
		private readonly db: Database,
		private readonly table: BanTable,
	) {}

	async has(id: string): Promise<boolean> {
		const rows = await this.db
			.select({ id: this.table.id })
			.from(this.table)
			.where(eq(this.table.id, id))
			.limit(1);
		return rows.length > 0;
	}

	async add(id: string): Promise<void> {
		await this.db.insert(this.table).values({ id }).onConflictDoNothing();
	}

	async remove(id: string): Promise<void> {
		await this.db.delete(this.table).where(eq(this.table.id, id));
	}

	async list(): Promise<string[]> {
		const rows = await this.db
			.select({ id: this.table.id })
			.from(this.table)
			.orderBy(asc(this.table.id));
		return rows.map((row) => row.id);
	}
}
