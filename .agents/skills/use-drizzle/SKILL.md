---
name: use-drizzle
description: Write and change this project's PostgreSQL schema, Drizzle ORM queries, repositories, transactions, migrations, and database tests. Use for any task that reads or writes database data or changes src/database, src/repositories, drizzle.config.ts, or drizzle migrations.
---

# Use Drizzle

## Inspect first

- Read `src/database/schema.ts`, the affected repository, and its callers.
- Preserve existing SQL names, types, defaults, constraints, indexes, and public repository results unless the task requires a change.
- Reuse the shared `Database` type from `src/database/client.ts`. Pass it to repositories; do not create database connections inside them.

## Write queries

- Use Drizzle's query builder for selects, inserts, updates, deletes, joins, ordering, limits, conflicts, and returning rows.
- Import tables and columns from `src/database/schema.ts`. Do not duplicate table definitions or use dynamic table or column names.
- Use Drizzle operators such as `eq`, `and`, `inArray`, `asc`, and `desc`.
- Use `sql` only when the query builder cannot express a database operation clearly, such as an aggregate expression. Interpolate tables, columns, and values through Drizzle's `sql` template.
- Never use `Bun.sql`, `Bun.SQL`, `.unsafe()`, `pg`, `postgres`, or `postgres.js` in application code.
- Let schema property names produce camel-case result objects. Add mapping only for domain conversions, such as converting a `bigint` ID to a string.
- Return `null`, empty collections, or errors consistently with the repository's existing contract.

## Preserve invariants

- Put related writes in `db.transaction(...)`.
- Keep read-check-write sequences in one transaction. Use `.for("update")` when concurrent updates must serialize.
- Prefer database constraints and conflict clauses over duplicate application checks.
- Check required rows returned by `.returning()` and throw a useful error if a write unexpectedly returns none.

## Change the schema

1. Edit `src/database/schema.ts`; treat it as the schema source of truth.
2. Run `bun run db:generate`.
3. Review and commit the generated files under `drizzle/`.
4. Do not edit an applied migration or use schema push. Add a new migration.
5. Keep startup migration behavior in `src/database/migrate.ts`.

Use explicit names for constraints and indexes when compatibility with an existing database depends on the name.

## Test and verify

- In database tests, create the client with `createDatabase(DATABASE_URL_TESTING)`, run `migrateDatabase(db)`, and close it with `db.$client.close()`.
- Use Drizzle queries to arrange and inspect data. Use `db.execute(sql\`...\`)` only for static test administration such as `TRUNCATE`.
- Add the smallest repository behavior test that would fail if the query is wrong.
- Run `bun run test`, `bun run typecheck`, and `bun run check`.
- After a schema change, run `bun run db:generate` again and confirm that it creates no additional migration.
