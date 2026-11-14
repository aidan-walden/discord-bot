class TrieNode<T> {
	readonly next = new Map<string, TrieNode<T>>();
	fail: TrieNode<T> = this;
	/** Values of every pattern ending here, including those reached via fail links. */
	outputs: T[] = [];
}

/**
 * Multi-pattern substring search: one pass over the text finds every pattern
 * it contains, regardless of how many patterns there are. Each pattern carries
 * a value; `search` returns the distinct values whose pattern occurs.
 *
 * Text is walked by code point, so patterns and text must use the same
 * normalisation (for example, both lowercased) for case-insensitive search.
 */
export default class AhoCorasick<T> {
	private readonly root = new TrieNode<T>();
	readonly patternCount: number;

	constructor(entries: Iterable<readonly [pattern: string, value: T]>) {
		let patternCount = 0;
		for (const [pattern, value] of entries) {
			if (pattern.length === 0) {
				throw new Error("Aho-Corasick patterns must be non-empty");
			}
			let node = this.root;
			for (const char of pattern) {
				let child = node.next.get(char);
				if (!child) {
					child = new TrieNode<T>();
					node.next.set(char, child);
				}
				node = child;
			}
			node.outputs.push(value);
			patternCount++;
		}
		this.patternCount = patternCount;
		this.buildFailLinks();
	}

	/** Breadth-first, so each node's fail target is finished before it is used. */
	private buildFailLinks(): void {
		const queue = [...this.root.next.values()];
		for (const child of queue) {
			child.fail = this.root;
		}
		// The array iterator re-reads the length, so nodes pushed below are visited.
		for (const node of queue) {
			for (const [char, child] of node.next) {
				let fallback = node.fail;
				while (fallback !== this.root && !fallback.next.has(char)) {
					fallback = fallback.fail;
				}
				child.fail = fallback.next.get(char) ?? this.root;
				if (child.fail.outputs.length > 0) {
					child.outputs = child.outputs.concat(child.fail.outputs);
				}
				queue.push(child);
			}
		}
	}

	search(text: string): Set<T> {
		const found = new Set<T>();
		if (this.patternCount === 0) {
			return found;
		}
		let node = this.root;
		for (const char of text) {
			let next = node.next.get(char);
			while (!next && node !== this.root) {
				node = node.fail;
				next = node.next.get(char);
			}
			node = next ?? this.root;
			for (const value of node.outputs) {
				found.add(value);
			}
		}
		return found;
	}
}
