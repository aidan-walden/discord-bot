import { drizzle } from "drizzle-orm/bun-sql";
import * as schema from "./schema";

export function createDatabase(url: string) {
	return drizzle(url, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
