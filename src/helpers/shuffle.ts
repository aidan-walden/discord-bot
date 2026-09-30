/** Fisher–Yates shuffle; `randomInt(n)` must return an integer in [0, n). */
export function shuffleInPlace<T>(
	items: T[],
	randomInt: (maxExclusive: number) => number,
): void {
	for (let i = items.length - 1; i > 0; i--) {
		const j = randomInt(i + 1);
		const tmp = items[i] as T;
		items[i] = items[j] as T;
		items[j] = tmp;
	}
}
