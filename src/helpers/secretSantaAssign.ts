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

	// Hopcroft-Karp: O(E * sqrt(V)) bipartite matching
	const matchGiver = new Map<string, string>();
	const matchRecipient = new Map<string, string>();
	const dist = new Map<string, number>();
	const INF = Number.POSITIVE_INFINITY;
	// Phase shortest augmenting path length (classic dist[NIL])
	let shortest = INF;

	function bfs(): boolean {
		const queue: string[] = [];
		for (const giver of givers) {
			if (!matchGiver.has(giver)) {
				dist.set(giver, 0);
				queue.push(giver);
			} else {
				dist.set(giver, INF);
			}
		}
		shortest = INF;
		for (let qi = 0; qi < queue.length; qi++) {
			const giver = queue[qi] as string;
			const d = dist.get(giver) ?? INF;
			// Do not expand at/after first free-recipient layer
			if (d >= shortest) {
				continue;
			}
			for (const recipient of adj.get(giver) ?? []) {
				const paired = matchRecipient.get(recipient);
				if (paired === undefined) {
					if (shortest === INF) {
						shortest = d + 1;
					}
				} else if ((dist.get(paired) ?? INF) === INF) {
					dist.set(paired, d + 1);
					queue.push(paired);
				}
			}
		}
		return shortest !== INF;
	}

	function dfs(giver: string): boolean {
		const d = dist.get(giver) ?? INF;
		for (const recipient of adj.get(giver) ?? []) {
			const paired = matchRecipient.get(recipient);
			const nextDist =
				paired === undefined ? shortest : (dist.get(paired) ?? INF);
			if (nextDist === d + 1 && (paired === undefined || dfs(paired))) {
				matchGiver.set(giver, recipient);
				matchRecipient.set(recipient, giver);
				return true;
			}
		}
		dist.set(giver, INF);
		return false;
	}

	while (bfs()) {
		for (const giver of givers) {
			if (!matchGiver.has(giver)) {
				dfs(giver);
			}
		}
	}

	if (matchGiver.size !== n) {
		return null;
	}

	const assignment = new Map(matchGiver);

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
