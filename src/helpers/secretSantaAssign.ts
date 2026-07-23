// ponytail: backtracking fine for n≪100; Hopcroft–Karp if ever huge

export type ExclusionPair = readonly [string, string];

function exclusionKey(a: string, b: string): string {
	return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		const tmp = items[i] as T;
		items[i] = items[j] as T;
		items[j] = tmp;
	}
}

/**
 * Perfect matching: each participant gives to exactly one other participant,
 * no self-gifts, mutual exclusions respected. Returns null if impossible.
 */
export function assignSecretSanta(
	participantIds: readonly string[],
	exclusions: readonly ExclusionPair[] = [],
	rng: () => number = Math.random,
): Map<string, string> | null {
	const n = participantIds.length;
	if (n < 2) {
		return null;
	}

	const ids = [...participantIds];
	const idSet = new Set(ids);
	if (idSet.size !== n) {
		return null;
	}

	const blocked = new Set<string>();
	for (const [a, b] of exclusions) {
		if (a === b) {
			continue;
		}
		if (!idSet.has(a) || !idSet.has(b)) {
			continue;
		}
		blocked.add(exclusionKey(a, b));
	}

	const adj = new Map<string, string[]>();
	for (const giver of ids) {
		const recipients: string[] = [];
		for (const recipient of ids) {
			if (giver === recipient) {
				continue;
			}
			if (blocked.has(exclusionKey(giver, recipient))) {
				continue;
			}
			recipients.push(recipient);
		}
		if (recipients.length === 0) {
			return null;
		}
		shuffleInPlace(recipients, rng);
		adj.set(giver, recipients);
	}

	const givers = [...ids].sort(
		(a, b) => (adj.get(a)?.length ?? 0) - (adj.get(b)?.length ?? 0),
	);

	const assignment = new Map<string, string>();
	const taken = new Set<string>();

	function solve(index: number): boolean {
		if (index >= givers.length) {
			return true;
		}
		const giver = givers[index] as string;
		const options = adj.get(giver) ?? [];
		for (const recipient of options) {
			if (taken.has(recipient)) {
				continue;
			}
			taken.add(recipient);
			assignment.set(giver, recipient);
			if (solve(index + 1)) {
				return true;
			}
			taken.delete(recipient);
			assignment.delete(giver);
		}
		return false;
	}

	if (!solve(0)) {
		return null;
	}

	if (assignment.size !== n) {
		return null;
	}
	const recipients = new Set(assignment.values());
	if (recipients.size !== n) {
		return null;
	}
	for (const [giver, recipient] of assignment) {
		if (giver === recipient) {
			return null;
		}
		if (blocked.has(exclusionKey(giver, recipient))) {
			return null;
		}
		if (!idSet.has(giver) || !idSet.has(recipient)) {
			return null;
		}
	}

	return assignment;
}
