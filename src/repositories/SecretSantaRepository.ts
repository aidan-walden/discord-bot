import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Database } from "../database/client";
import {
	secretSantaAssignments,
	secretSantaDraws,
	secretSantaExclusions,
	secretSantaParticipants,
} from "../database/schema";

export type SecretSantaDraw = typeof secretSantaDraws.$inferSelect;

export type SecretSantaExclusion = {
	userA: string;
	userB: string;
};

export type SecretSantaAssignment = {
	giverId: string;
	recipientId: string;
};

export type AddParticipantResult =
	| "added"
	| "already-present"
	| "missing"
	| "closed"
	| "locked";

export type RemoveParticipantResult =
	| "removed"
	| "not-present"
	| "missing"
	| "locked";

export type FinalizeAssignmentsResult =
	| {
			status: "committed";
			draw: SecretSantaDraw;
			pairs: SecretSantaAssignment[];
	  }
	| {
			status: "missing" | "stale" | "wrong-mode" | "too-few" | "impossible";
	  };

const exclusionColumns = {
	userA: secretSantaExclusions.userA,
	userB: secretSantaExclusions.userB,
};

const assignmentColumns = {
	giverId: secretSantaAssignments.giverId,
	recipientId: secretSantaAssignments.recipientId,
};

export default class SecretSantaRepository {
	constructor(private readonly db: Database) {}

	async create(name: string): Promise<SecretSantaDraw> {
		const rows = await this.db
			.insert(secretSantaDraws)
			.values({ name })
			.returning();
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to create secret santa draw");
		}
		return row;
	}

	async delete(name: string): Promise<boolean> {
		const rows = await this.db
			.delete(secretSantaDraws)
			.where(eq(secretSantaDraws.name, name))
			.returning({ name: secretSantaDraws.name });
		return rows.length > 0;
	}

	async get(name: string): Promise<SecretSantaDraw | null> {
		const rows = await this.db
			.select()
			.from(secretSantaDraws)
			.where(eq(secretSantaDraws.name, name));
		return rows[0] ?? null;
	}

	async list(): Promise<SecretSantaDraw[]> {
		return this.db
			.select()
			.from(secretSantaDraws)
			.orderBy(asc(secretSantaDraws.createdAt));
	}

	async setOpen(name: string, open: boolean): Promise<SecretSantaDraw | null> {
		const rows = await this.db
			.update(secretSantaDraws)
			.set({ open })
			.where(eq(secretSantaDraws.name, name))
			.returning();
		return rows[0] ?? null;
	}

	async setSpendLimitCents(
		name: string,
		cents: number | null,
	): Promise<SecretSantaDraw | null> {
		const rows = await this.db
			.update(secretSantaDraws)
			.set({ spendLimitCents: cents })
			.where(eq(secretSantaDraws.name, name))
			.returning();
		return rows[0] ?? null;
	}

	async addParticipant(
		name: string,
		userId: string,
	): Promise<AddParticipantResult> {
		return this.db.transaction(async (tx) => {
			const draws = await tx
				.select({
					open: secretSantaDraws.open,
					drawnAt: secretSantaDraws.drawnAt,
				})
				.from(secretSantaDraws)
				.where(eq(secretSantaDraws.name, name))
				.for("update");
			const draw = draws[0];
			if (!draw) return "missing";
			if (draw.drawnAt) return "locked";
			if (!draw.open) return "closed";

			const rows = await tx
				.insert(secretSantaParticipants)
				.values({ drawName: name, userId })
				.onConflictDoNothing()
				.returning({ userId: secretSantaParticipants.userId });
			return rows.length > 0 ? "added" : "already-present";
		});
	}

	async removeParticipant(
		name: string,
		userId: string,
	): Promise<RemoveParticipantResult> {
		return this.db.transaction(async (tx) => {
			const draws = await tx
				.select({ drawnAt: secretSantaDraws.drawnAt })
				.from(secretSantaDraws)
				.where(eq(secretSantaDraws.name, name))
				.for("update");
			const draw = draws[0];
			if (!draw) return "missing";
			if (draw.drawnAt) return "locked";

			const rows = await tx
				.delete(secretSantaParticipants)
				.where(
					and(
						eq(secretSantaParticipants.drawName, name),
						eq(secretSantaParticipants.userId, userId),
					),
				)
				.returning({ userId: secretSantaParticipants.userId });
			return rows.length > 0 ? "removed" : "not-present";
		});
	}

	async listParticipants(name: string): Promise<string[]> {
		const rows = await this.db
			.select({ userId: secretSantaParticipants.userId })
			.from(secretSantaParticipants)
			.where(eq(secretSantaParticipants.drawName, name))
			.orderBy(asc(secretSantaParticipants.userId));
		return rows.map((row) => row.userId);
	}

	async addExclusions(name: string, userIds: string[]): Promise<number> {
		const unique = [...new Set(userIds)];
		if (unique.length < 2) {
			return 0;
		}

		let inserted = 0;
		for (let i = 0; i < unique.length; i++) {
			for (let j = i + 1; j < unique.length; j++) {
				const a = unique[i] as string;
				const b = unique[j] as string;
				const userA = a < b ? a : b;
				const userB = a < b ? b : a;
				const rows = await this.db
					.insert(secretSantaExclusions)
					.values({ drawName: name, userA, userB })
					.onConflictDoNothing()
					.returning({ userA: secretSantaExclusions.userA });
				inserted += rows.length;
			}
		}
		return inserted;
	}

	async listExclusions(name: string): Promise<SecretSantaExclusion[]> {
		return this.db
			.select(exclusionColumns)
			.from(secretSantaExclusions)
			.where(eq(secretSantaExclusions.drawName, name))
			.orderBy(
				asc(secretSantaExclusions.userA),
				asc(secretSantaExclusions.userB),
			);
	}

	async finalizeAssignments(
		name: string,
		expectedRevision: number,
		reroll: boolean,
		assign: (
			participants: string[],
			exclusions: SecretSantaExclusion[],
		) => SecretSantaAssignment[] | null,
	): Promise<FinalizeAssignmentsResult> {
		return this.db.transaction(async (tx) => {
			const draws = await tx
				.select()
				.from(secretSantaDraws)
				.where(eq(secretSantaDraws.name, name))
				.for("update");
			const draw = draws[0];
			if (!draw) return { status: "missing" };
			if (draw.revision !== expectedRevision) return { status: "stale" };
			if (reroll !== Boolean(draw.drawnAt)) return { status: "wrong-mode" };

			const participantRows = await tx
				.select({ userId: secretSantaParticipants.userId })
				.from(secretSantaParticipants)
				.where(eq(secretSantaParticipants.drawName, name))
				.orderBy(asc(secretSantaParticipants.userId));
			if (participantRows.length < 2) return { status: "too-few" };

			const exclusions = await tx
				.select(exclusionColumns)
				.from(secretSantaExclusions)
				.where(eq(secretSantaExclusions.drawName, name))
				.orderBy(
					asc(secretSantaExclusions.userA),
					asc(secretSantaExclusions.userB),
				);
			const pairs = assign(
				participantRows.map((row) => row.userId),
				exclusions,
			);
			if (!pairs) return { status: "impossible" };

			await tx
				.delete(secretSantaAssignments)
				.where(eq(secretSantaAssignments.drawName, name));
			for (const pair of pairs) {
				await tx
					.insert(secretSantaAssignments)
					.values({ drawName: name, ...pair });
			}
			const updated = await tx
				.update(secretSantaDraws)
				.set({
					drawnAt: sql`NOW()`,
					revision: sql`${secretSantaDraws.revision} + 1`,
				})
				.where(eq(secretSantaDraws.name, name))
				.returning();
			return {
				status: "committed",
				draw: updated[0] as SecretSantaDraw,
				pairs,
			};
		});
	}

	async listAssignments(name: string): Promise<SecretSantaAssignment[]> {
		return this.db
			.select(assignmentColumns)
			.from(secretSantaAssignments)
			.where(eq(secretSantaAssignments.drawName, name))
			.orderBy(asc(secretSantaAssignments.giverId));
	}

	async participantCount(name: string): Promise<number> {
		const rows = await this.db
			.select({ count: count() })
			.from(secretSantaParticipants)
			.where(eq(secretSantaParticipants.drawName, name));
		return rows[0]?.count ?? 0;
	}
}
