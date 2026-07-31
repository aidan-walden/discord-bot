import { describe, expect, test } from "bun:test";
import {
	type TemporaryStateRedisClient,
	TemporaryStateRepository,
} from "./TemporaryStateRepository";

class FakeRedisClient implements TemporaryStateRedisClient {
	readonly store = new Map<string, string>();
	readonly expires = new Map<string, number>();
	connected = false;
	closed = false;
	readonly calls: Array<{ method: string; args: unknown[] }> = [];

	async connect(): Promise<void> {
		this.calls.push({ method: "connect", args: [] });
		this.connected = true;
	}

	async get(key: string): Promise<string | null> {
		this.calls.push({ method: "get", args: [key] });
		return this.store.get(key) ?? null;
	}

	async set(key: string, value: string): Promise<"OK"> {
		this.calls.push({ method: "set", args: [key, value] });
		this.store.set(key, value);
		return "OK";
	}

	async send(command: string, args: string[]): Promise<unknown> {
		this.calls.push({ method: "send", args: [command, args] });
		if (command === "SET") {
			const [key, value, exFlag, ttl] = args;
			if (key === undefined || value === undefined) {
				throw new Error("SET requires key and value");
			}
			this.store.set(key, value);
			if (exFlag === "EX" && ttl !== undefined) {
				this.expires.set(key, Number(ttl));
			}
			return "OK";
		}
		throw new Error(`unsupported command: ${command}`);
	}

	async del(...keys: string[]): Promise<number> {
		this.calls.push({ method: "del", args: keys });
		let removed = 0;
		for (const key of keys) {
			if (this.store.delete(key)) {
				removed += 1;
			}
			this.expires.delete(key);
		}
		return removed;
	}

	close(): void {
		this.calls.push({ method: "close", args: [] });
		this.closed = true;
		this.connected = false;
	}
}

describe("TemporaryStateRepository", () => {
	test("connect and close delegate to the client", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);

		await repo.connect();
		repo.close();

		expect(client.connected).toBe(false);
		expect(client.closed).toBe(true);
		expect(client.calls.map((c) => c.method)).toEqual(["connect", "close"]);
	});

	test("prefixes keys and round-trips JSON values", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);
		const value = { nested: [1, "two"], ok: true };

		await repo.set("session:abc", value);

		expect(client.store.get("discord-bot:v1:session:abc")).toBe(
			JSON.stringify(value),
		);
		expect(await repo.get<typeof value>("session:abc")).toEqual(value);
		expect(client.calls.find((c) => c.method === "get")?.args).toEqual([
			"discord-bot:v1:session:abc",
		]);
	});

	test("get returns null for missing keys", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);

		expect(await repo.get("missing")).toBeNull();
	});

	test("set with TTL uses one atomic SET EX command", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);

		await repo.set("ttl-key", { a: 1 }, 60);

		expect(client.store.get("discord-bot:v1:ttl-key")).toBe('{"a":1}');
		expect(client.expires.get("discord-bot:v1:ttl-key")).toBe(60);
		expect(client.calls).toEqual([
			{
				method: "send",
				args: ["SET", ["discord-bot:v1:ttl-key", '{"a":1}', "EX", "60"]],
			},
		]);
		expect(client.calls.some((c) => c.method === "set")).toBe(false);
		expect(client.calls.some((c) => c.method === "expire")).toBe(false);
	});

	test("set without TTL uses plain set", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);

		await repo.set("no-ttl", { a: 1 });

		expect(client.calls.map((c) => c.method)).toEqual(["set"]);
		expect(client.expires.has("discord-bot:v1:no-ttl")).toBe(false);
	});

	test("set ignores non-positive TTL and does not write", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);

		await repo.set("bad-ttl", { a: 1 }, 0);
		await repo.set("bad-ttl", { a: 1 }, -5);

		expect(client.store.size).toBe(0);
		expect(client.calls).toEqual([]);
	});

	test("delete removes the prefixed key", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);

		await repo.set("to-delete", "x");
		await repo.delete("to-delete");

		expect(client.store.has("discord-bot:v1:to-delete")).toBe(false);
		expect(await repo.get("to-delete")).toBeNull();
	});

	test("malformed JSON deletes the key and returns null", async () => {
		const client = new FakeRedisClient();
		const repo = new TemporaryStateRepository(client);
		client.store.set("discord-bot:v1:broken", "not-json{");

		expect(await repo.get("broken")).toBeNull();
		expect(client.store.has("discord-bot:v1:broken")).toBe(false);
		expect(client.calls.map((c) => c.method)).toEqual(["get", "del"]);
	});
});
