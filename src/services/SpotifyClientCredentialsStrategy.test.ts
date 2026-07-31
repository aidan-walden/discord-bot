import { describe, expect, mock, test } from "bun:test";
import type { AccessToken } from "@spotify/web-api-ts-sdk";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";
import SpotifyClientCredentialsStrategy from "./SpotifyClientCredentialsStrategy";

const REDIS_KEY = "spotify:client-credentials-token";

function createMemoryStore(): Pick<
	TemporaryStateRepository,
	"get" | "set" | "delete"
> & {
	data: Map<string, unknown>;
	ttls: Map<string, number>;
} {
	const data = new Map<string, unknown>();
	const ttls = new Map<string, number>();
	return {
		data,
		ttls,
		async get<T>(key: string): Promise<T | null> {
			if (!data.has(key)) {
				return null;
			}
			return data.get(key) as T;
		},
		async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
			if (ttlSeconds !== undefined && ttlSeconds <= 0) {
				return;
			}
			data.set(key, value);
			if (ttlSeconds !== undefined) {
				ttls.set(key, ttlSeconds);
			}
		},
		async delete(key: string): Promise<void> {
			data.delete(key);
			ttls.delete(key);
		},
	};
}

function tokenResponse(expiresIn = 3600): Response {
	return new Response(
		JSON.stringify({
			access_token: "fresh-token",
			token_type: "Bearer",
			expires_in: expiresIn,
			refresh_token: "",
		}),
		{ status: 200 },
	);
}

function createApi(
	status: number,
	store = createMemoryStore(),
	fetchImpl?: () => Promise<Response>,
) {
	const recordCredentialRejection = mock(() => undefined);
	const fetcher =
		fetchImpl ??
		mock(async () =>
			status === 200 ? tokenResponse() : new Response(null, { status }),
		);
	const strategy = new SpotifyClientCredentialsStrategy(
		"client-id",
		"client-secret",
		{ recordCredentialRejection },
		store,
	);
	const api = new SpotifyApi(strategy, { fetch: fetcher });
	return { api, fetcher, recordCredentialRejection, store, strategy };
}

function cachedToken(overrides: Partial<AccessToken> = {}): AccessToken {
	return {
		access_token: "cached-token",
		token_type: "Bearer",
		expires_in: 3600,
		refresh_token: "",
		expires: Date.now() + 3_600_000,
		...overrides,
	};
}

describe("SpotifyClientCredentialsStrategy", () => {
	test("reports rejected client credentials", async () => {
		const { api, fetcher, recordCredentialRejection } = createApi(401);

		expect(api.authenticate()).rejects.toThrow(
			"Failed to get Spotify access token.",
		);

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(recordCredentialRejection).toHaveBeenCalledWith("spotify");
	});

	test("does not report an upstream Spotify failure as credential rejection", async () => {
		const { api, recordCredentialRejection } = createApi(500);

		expect(api.authenticate()).rejects.toThrow(
			"Failed to get Spotify access token.",
		);

		expect(recordCredentialRejection).not.toHaveBeenCalled();
	});

	test("stores a fetched token in temporary state with expiry TTL", async () => {
		const store = createMemoryStore();
		const { api } = createApi(200, store);

		await api.authenticate();

		const stored = store.data.get(REDIS_KEY) as AccessToken;
		expect(stored.access_token).toBe("fresh-token");
		expect(typeof stored.expires).toBe("number");
		expect(store.ttls.get(REDIS_KEY)).toBeGreaterThanOrEqual(1);
	});

	test("restores a valid Redis token into a fresh process without refetching", async () => {
		const store = createMemoryStore();
		const existing = cachedToken({ access_token: "redis-token" });
		await store.set(REDIS_KEY, existing, 3600);

		const fetcher = mock(async () => tokenResponse());
		const { api } = createApi(200, store, fetcher);

		const token = await api.getAccessToken();

		expect(token?.access_token).toBe("redis-token");
		expect(fetcher).not.toHaveBeenCalled();
	});

	test("removes expired or malformed Redis tokens", async () => {
		const store = createMemoryStore();
		await store.set(
			REDIS_KEY,
			cachedToken({ access_token: "old", expires: Date.now() - 1 }),
			1,
		);

		const fetcher = mock(async () => tokenResponse());
		const { api } = createApi(200, store, fetcher);
		await api.authenticate();

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect((store.data.get(REDIS_KEY) as AccessToken).access_token).toBe(
			"fresh-token",
		);

		await store.set(REDIS_KEY, { not: "a-token" }, 60);
		const second = createApi(
			200,
			store,
			mock(async () => tokenResponse()),
		);
		await second.api.authenticate();
		expect(second.fetcher).toHaveBeenCalledTimes(1);
	});

	test("removeAccessToken deletes Redis immediately and next get awaits it", async () => {
		const store = createMemoryStore();
		let deleteStarted = false;
		let releaseDelete!: () => void;
		const deleteBlocked = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		const originalDelete = store.delete.bind(store);
		store.delete = mock(async (key: string) => {
			deleteStarted = true;
			await deleteBlocked;
			await originalDelete(key);
		});
		const { api, strategy } = createApi(200, store);
		await api.authenticate();
		expect(store.data.has(REDIS_KEY)).toBe(true);

		strategy.removeAccessToken();
		expect(deleteStarted).toBe(true);
		expect(store.data.has(REDIS_KEY)).toBe(true);

		let getDone = false;
		const getPromise = strategy.getAccessToken().then((token) => {
			getDone = true;
			return token;
		});
		await Promise.resolve();
		expect(getDone).toBe(false);

		releaseDelete();
		await getPromise;
		expect(store.data.has(REDIS_KEY)).toBe(false);
		expect(store.delete).toHaveBeenCalled();
	});
});
