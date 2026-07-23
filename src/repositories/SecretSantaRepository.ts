export type SecretSantaDraw = {
	name: string;
	open: boolean;
	spendLimitCents: number | null;
	drawnAt: Date | null;
	revision: number;
	createdAt: Date;
};

export type SecretSantaExclusion = {
	userA: string;
	userB: string;
};

export type SecretSantaAssignment = {
	giverId: string;
	recipientId: string;
};

type DrawRow = {
	name: string;
	open: boolean;
	spend_limit_cents: number | null;
	drawn_at: Date | null;
	revision: number;
	created_at: Date;
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

type ExclusionRow = {
	user_a: string;
	user_b: string;
};

type AssignmentRow = {
	giver_id: string;
	recipient_id: string;
};

function mapDraw(row: DrawRow): SecretSantaDraw {
	return {
		name: row.name,
		open: row.open,
		spendLimitCents: row.spend_limit_cents,
		drawnAt: row.drawn_at,
		revision: row.revision,
		createdAt: row.created_at,
	};
}

export default class SecretSantaRepository {
	constructor(private readonly sql: typeof Bun.sql) {}

	async create(name: string): Promise<SecretSantaDraw> {
		const rows = await this.sql<DrawRow[]>`
			INSERT INTO secret_santa_draws (name)
			VALUES (${name})
			RETURNING name, open, spend_limit_cents, drawn_at, revision, created_at
		`;
		const row = rows[0];
		if (!row) {
			throw new Error("Failed to create secret santa draw");
		}
		return mapDraw(row);
	}

	async delete(name: string): Promise<boolean> {
		const rows = await this.sql<{ name: string }[]>`
			DELETE FROM secret_santa_draws
			WHERE name = ${name}
			RETURNING name
		`;
		return rows.length > 0;
	}

	async get(name: string): Promise<SecretSantaDraw | null> {
		const rows = await this.sql<DrawRow[]>`
			SELECT name, open, spend_limit_cents, drawn_at, revision, created_at
			FROM secret_santa_draws
			WHERE name = ${name}
		`;
		const row = rows[0];
		return row ? mapDraw(row) : null;
	}

	async list(): Promise<SecretSantaDraw[]> {
		const rows = await this.sql<DrawRow[]>`
			SELECT name, open, spend_limit_cents, drawn_at, revision, created_at
			FROM secret_santa_draws
			ORDER BY created_at ASC
		`;
		return rows.map(mapDraw);
	}

	async setOpen(name: string, open: boolean): Promise<SecretSantaDraw | null> {
		const rows = await this.sql<DrawRow[]>`
			UPDATE secret_santa_draws
			SET open = ${open}
			WHERE name = ${name}
			RETURNING name, open, spend_limit_cents, drawn_at, revision, created_at
		`;
		const row = rows[0];
		return row ? mapDraw(row) : null;
	}

	async setSpendLimitCents(
		name: string,
		cents: number | null,
	): Promise<SecretSantaDraw | null> {
		const rows = await this.sql<DrawRow[]>`
			UPDATE secret_santa_draws
			SET spend_limit_cents = ${cents}
			WHERE name = ${name}
			RETURNING name, open, spend_limit_cents, drawn_at, revision, created_at
		`;
		const row = rows[0];
		return row ? mapDraw(row) : null;
	}

	async addParticipant(
		name: string,
		userId: string,
	): Promise<AddParticipantResult> {
		return this.sql.begin(async (tx) => {
			const draws = await tx<Pick<DrawRow, "open" | "drawn_at">[]>`
				SELECT open, drawn_at
				FROM secret_santa_draws
				WHERE name = ${name}
				FOR UPDATE
			`;
			const draw = draws[0];
			if (!draw) return "missing";
			if (draw.drawn_at) return "locked";
			if (!draw.open) return "closed";

			const rows = await tx<{ user_id: string }[]>`
				INSERT INTO secret_santa_participants (draw_name, user_id)
				VALUES (${name}, ${userId})
				ON CONFLICT DO NOTHING
				RETURNING user_id
			`;
			return rows.length > 0 ? "added" : "already-present";
		});
	}

	async removeParticipant(
		name: string,
		userId: string,
	): Promise<RemoveParticipantResult> {
		return this.sql.begin(async (tx) => {
			const draws = await tx<Pick<DrawRow, "drawn_at">[]>`
				SELECT drawn_at
				FROM secret_santa_draws
				WHERE name = ${name}
				FOR UPDATE
			`;
			const draw = draws[0];
			if (!draw) return "missing";
			if (draw.drawn_at) return "locked";

			const rows = await tx<{ user_id: string }[]>`
				DELETE FROM secret_santa_participants
				WHERE draw_name = ${name} AND user_id = ${userId}
				RETURNING user_id
			`;
			return rows.length > 0 ? "removed" : "not-present";
		});
	}

	async listParticipants(name: string): Promise<string[]> {
		const rows = await this.sql<{ user_id: string }[]>`
			SELECT user_id
			FROM secret_santa_participants
			WHERE draw_name = ${name}
			ORDER BY user_id ASC
		`;
		return rows.map((r) => r.user_id);
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
				const rows = await this.sql<{ user_a: string }[]>`
					INSERT INTO secret_santa_exclusions (draw_name, user_a, user_b)
					VALUES (${name}, ${userA}, ${userB})
					ON CONFLICT DO NOTHING
					RETURNING user_a
				`;
				inserted += rows.length;
			}
		}
		return inserted;
	}

	async listExclusions(name: string): Promise<SecretSantaExclusion[]> {
		const rows = await this.sql<ExclusionRow[]>`
			SELECT user_a, user_b
			FROM secret_santa_exclusions
			WHERE draw_name = ${name}
			ORDER BY user_a ASC, user_b ASC
		`;
		return rows.map((r) => ({ userA: r.user_a, userB: r.user_b }));
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
		return this.sql.begin(async (tx) => {
			const draws = await tx<DrawRow[]>`
				SELECT name, open, spend_limit_cents, drawn_at, revision, created_at
				FROM secret_santa_draws
				WHERE name = ${name}
				FOR UPDATE
			`;
			const draw = draws[0];
			if (!draw) return { status: "missing" };
			if (draw.revision !== expectedRevision) return { status: "stale" };
			if (reroll !== Boolean(draw.drawn_at)) return { status: "wrong-mode" };

			const participantRows = await tx<{ user_id: string }[]>`
				SELECT user_id
				FROM secret_santa_participants
				WHERE draw_name = ${name}
				ORDER BY user_id ASC
			`;
			if (participantRows.length < 2) return { status: "too-few" };

			const exclusionRows = await tx<ExclusionRow[]>`
				SELECT user_a, user_b
				FROM secret_santa_exclusions
				WHERE draw_name = ${name}
				ORDER BY user_a ASC, user_b ASC
			`;
			const pairs = assign(
				participantRows.map((row) => row.user_id),
				exclusionRows.map((row) => ({ userA: row.user_a, userB: row.user_b })),
			);
			if (!pairs) return { status: "impossible" };

			await tx`
				DELETE FROM secret_santa_assignments
				WHERE draw_name = ${name}
			`;
			for (const pair of pairs) {
				await tx`
					INSERT INTO secret_santa_assignments (draw_name, giver_id, recipient_id)
					VALUES (${name}, ${pair.giverId}, ${pair.recipientId})
				`;
			}
			const updated = await tx<DrawRow[]>`
				UPDATE secret_santa_draws
				SET drawn_at = NOW(), revision = revision + 1
				WHERE name = ${name}
				RETURNING name, open, spend_limit_cents, drawn_at, revision, created_at
			`;
			return {
				status: "committed",
				draw: mapDraw(updated[0] as DrawRow),
				pairs,
			};
		});
	}

	async listAssignments(name: string): Promise<SecretSantaAssignment[]> {
		const rows = await this.sql<AssignmentRow[]>`
			SELECT giver_id, recipient_id
			FROM secret_santa_assignments
			WHERE draw_name = ${name}
			ORDER BY giver_id ASC
		`;
		return rows.map((r) => ({
			giverId: r.giver_id,
			recipientId: r.recipient_id,
		}));
	}

	async participantCount(name: string): Promise<number> {
		const rows = await this.sql<{ count: string }[]>`
			SELECT COUNT(*)::text AS count
			FROM secret_santa_participants
			WHERE draw_name = ${name}
		`;
		return Number(rows[0]?.count ?? 0);
	}
}
