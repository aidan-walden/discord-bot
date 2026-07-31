const KEY_PREFIX = "discord-bot:v1:";

/** Minimal Redis surface used by this store (Bun RedisClient-compatible). */
export type TemporaryStateRedisClient = {
	connect(): Promise<void>;
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<unknown>;
	send(command: string, args: string[]): Promise<unknown>;
	del(...keys: string[]): Promise<unknown>;
	close(): void;
};

export class TemporaryStateRepository {
	constructor(private readonly client: TemporaryStateRedisClient) {}

	private physicalKey(key: string): string {
		return `${KEY_PREFIX}${key}`;
	}

	async connect(): Promise<void> {
		await this.client.connect();
	}

	async get<T>(key: string): Promise<T | null> {
		const physical = this.physicalKey(key);
		const raw = await this.client.get(physical);
		if (raw === null) {
			return null;
		}
		try {
			return JSON.parse(raw) as T;
		} catch {
			await this.client.del(physical);
			return null;
		}
	}

	async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
		if (ttlSeconds !== undefined && ttlSeconds <= 0) {
			return;
		}
		const physical = this.physicalKey(key);
		const serialized = JSON.stringify(value);
		if (ttlSeconds !== undefined) {
			await this.client.send("SET", [
				physical,
				serialized,
				"EX",
				String(ttlSeconds),
			]);
			return;
		}
		await this.client.set(physical, serialized);
	}

	async delete(key: string): Promise<void> {
		await this.client.del(this.physicalKey(key));
	}

	close(): void {
		this.client.close();
	}
}
