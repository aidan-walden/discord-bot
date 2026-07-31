import { describe, expect, mock, test } from "bun:test";
import type LlmUserRateLimitRepository from "../repositories/LlmUserRateLimitRepository";
import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";
import {
	createLlmProviders,
	isCredentialFailure,
	LlmUserRateLimitError,
	LlmUserRateLimiter,
	llmRateLimitNotice,
} from "./LlmProvider";

function createMemoryStore(): Pick<
	TemporaryStateRepository,
	"get" | "set" | "delete"
> & {
	data: Map<string, unknown>;
} {
	const data = new Map<string, unknown>();
	return {
		data,
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
		},
		async delete(key: string): Promise<void> {
			data.delete(key);
		},
	};
}

function createLimiter(
	options: {
		defaultLimit?: number;
		override?: number | null;
		admins?: string[];
		now?: () => number;
		store?: Pick<TemporaryStateRepository, "get" | "set" | "delete">;
	} = {},
) {
	const get = mock(async () => options.override ?? null);
	const set = mock(async () => undefined);
	const remove = mock(async () => undefined);
	const repository = {
		get,
		set,
		remove,
	} as unknown as LlmUserRateLimitRepository;
	const store = options.store ?? createMemoryStore();
	const limiter = new LlmUserRateLimiter(
		options.defaultLimit ?? 5,
		repository,
		(userId) => options.admins?.includes(userId) ?? false,
		store,
		options.now,
	);
	return { get, limiter, remove, set, store };
}

function req(userId = "user-1"): { userId: string; requestId: string } {
	return { userId, requestId: crypto.randomUUID() };
}

describe("isCredentialFailure", () => {
	const cases: Array<[unknown, boolean]> = [
		[{ status: 401 }, true],
		[{ status: 403 }, false],
		[{ status: 403, type: "permission_error" }, false],
		[{ status: 403, code: "invalid_api_key" }, true],
		[{ status: 403, type: "authentication_error" }, true],
		[{ status: 429, code: "insufficient_quota" }, true],
		[{ status: 429, type: "billing_error" }, true],
		[{ status: 400, type: "billing_error" }, true],
		[{ status: 429, message: "Rate limited" }, false],
		[{ status: 500 }, false],
		[{ message: "no status" }, false],
		["not an object", false],
		[null, false],
	];

	for (const [error, expected] of cases) {
		test(`${JSON.stringify(error)} -> ${expected}`, () => {
			expect(isCredentialFailure(error)).toBe(expected);
		});
	}
});

describe("createLlmProviders", () => {
	test("orders OpenAI before Anthropic when both keys are set", () => {
		const providers = createLlmProviders(
			{ OPENAI_API_TOKEN: "sk-openai", OPENAI_MODEL: "gpt-test" },
			{ ANTHROPIC_API_TOKEN: "sk-anthropic" },
			createLimiter().limiter,
		);

		expect(providers.map((p) => p.name)).toEqual(["openai", "anthropic"]);
	});

	test("skips OpenAI when its model is missing and falls through to Anthropic", () => {
		const providers = createLlmProviders(
			{ OPENAI_API_TOKEN: "sk-openai" },
			{ ANTHROPIC_API_TOKEN: "sk-anthropic" },
			createLimiter().limiter,
		);

		expect(providers.map((p) => p.name)).toEqual(["anthropic"]);
	});

	test("returns Anthropic alone when only its key is set", () => {
		const providers = createLlmProviders(
			{},
			{ ANTHROPIC_API_TOKEN: "sk-anthropic" },
			createLimiter().limiter,
		);

		expect(providers.map((p) => p.name)).toEqual(["anthropic"]);
	});

	test("returns no providers when nothing is configured", () => {
		expect(createLlmProviders({}, {}, createLimiter().limiter)).toEqual([]);
	});
});

describe("LlmUserRateLimiter", () => {
	test("limits each user separately", async () => {
		const { limiter } = createLimiter({ defaultLimit: 1 });

		await limiter.assertAllowed(req("user-1"));
		await limiter.assertAllowed(req("user-2"));
		await expect(limiter.assertAllowed(req("user-1"))).rejects.toBeInstanceOf(
			LlmUserRateLimitError,
		);
	});

	test("reports when the oldest request leaves the window", async () => {
		let now = 1_000;
		const { limiter } = createLimiter({ defaultLimit: 1, now: () => now });

		await limiter.assertAllowed(req("user-1"));
		now += 5_000;
		const error = await limiter
			.assertAllowed(req("user-1"))
			.catch((e: unknown) => e as LlmUserRateLimitError);

		expect(error).toBeInstanceOf(LlmUserRateLimitError);
		expect((error as LlmUserRateLimitError).retryAt).toBe(
			1_000 + 60 * 60 * 1000,
		);
		expect(llmRateLimitNotice(error as LlmUserRateLimitError)).toContain(
			"You get 1 requests per hour.",
		);
	});

	test("allows a request again at the rolling-hour boundary", async () => {
		let now = 0;
		const { limiter } = createLimiter({
			defaultLimit: 1,
			now: () => now,
		});

		await limiter.assertAllowed(req("user-1"));
		now = 60 * 60 * 1000;
		await limiter.assertAllowed(req("user-1"));
	});

	test("counts one request context once across provider failover", async () => {
		const { limiter } = createLimiter({ defaultLimit: 1 });
		const request = req("user-1");

		await limiter.assertAllowed(request);
		await limiter.assertAllowed(request);
		await expect(limiter.assertAllowed(req("user-1"))).rejects.toBeInstanceOf(
			LlmUserRateLimitError,
		);
	});

	test("counts concurrent requests from one user", async () => {
		const { limiter } = createLimiter({ defaultLimit: 2 });
		const attempts = Array.from({ length: 4 }, () =>
			limiter
				.assertAllowed(req("user-1"))
				.then(() => "allowed" as const)
				.catch(() => "rejected" as const),
		);

		const results = await Promise.all(attempts);
		expect(results.filter((r) => r === "allowed")).toHaveLength(2);
	});

	test("uses positive and unlimited overrides", async () => {
		const limited = createLimiter({ defaultLimit: 1, override: 2 }).limiter;
		await limited.assertAllowed(req("user-1"));
		await limited.assertAllowed(req("user-1"));

		const unlimited = createLimiter({ override: -1 }).limiter;
		for (let index = 0; index < 10; index += 1) {
			await unlimited.assertAllowed(req("user-1"));
		}
	});

	test("admins bypass override reads and request history", async () => {
		const { get, limiter } = createLimiter({
			defaultLimit: 1,
			admins: ["admin-1"],
		});

		await limiter.assertAllowed(req("admin-1"));
		await limiter.assertAllowed(req("admin-1"));

		expect(get).not.toHaveBeenCalled();
	});

	test("persists positive and unlimited overrides and removes zero", async () => {
		const { limiter, remove, set } = createLimiter();

		await limiter.setOverride("user-1", 10);
		await limiter.setOverride("user-1", -1);
		await limiter.setOverride("user-1", 0);

		expect(set).toHaveBeenNthCalledWith(1, "user-1", 10);
		expect(set).toHaveBeenNthCalledWith(2, "user-1", -1);
		expect(remove).toHaveBeenCalledWith("user-1");
	});

	test.each([-2, 1.5, 2_147_483_648])(
		"setOverride rejects %p",
		async (value) => {
			const { limiter, set } = createLimiter();
			await expect(limiter.setOverride("user-1", value)).rejects.toThrow(
				"Requests per hour",
			);
			expect(set).not.toHaveBeenCalled();
		},
	);

	test("caches the override and re-reads it after setOverride", async () => {
		const { get, limiter } = createLimiter({ defaultLimit: 5 });
		const allow = () => limiter.assertAllowed(req("user-1"));

		await allow();
		await allow();
		expect(get).toHaveBeenCalledTimes(1);

		await limiter.setOverride("user-1", 10);
		await allow();
		expect(get).toHaveBeenCalledTimes(2);
	});

	test("refunds quota when the provider call fails", async () => {
		const { limiter } = createLimiter({ defaultLimit: 1 });
		const providers = createLlmProviders(
			{ OPENAI_API_TOKEN: "sk-openai", OPENAI_MODEL: "gpt-test" },
			{},
			limiter,
		);
		const create = mock(async () => {
			throw new Error("provider down");
		});
		(
			providers[0] as unknown as {
				client: { chat: { completions: { create: typeof create } } };
			}
		).client = { chat: { completions: { create } } };

		await expect(
			providers[0]?.complete(req("user-1"), "s", []),
		).rejects.toThrow("provider down");
		await expect(
			providers[0]?.complete(req("user-1"), "s", []),
		).rejects.toThrow("provider down");
		expect(create).toHaveBeenCalledTimes(2);
	});

	test("rejects before the provider SDK call", async () => {
		const { limiter } = createLimiter({ defaultLimit: 1 });
		const providers = createLlmProviders(
			{ OPENAI_API_TOKEN: "sk-openai", OPENAI_MODEL: "gpt-test" },
			{},
			limiter,
		);
		const create = mock(async () => ({
			choices: [{ message: { content: "ok" } }],
		}));
		(
			providers[0] as unknown as {
				client: { chat: { completions: { create: typeof create } } };
			}
		).client = { chat: { completions: { create } } };

		await providers[0]?.complete(req("user-1"), "system", []);
		await expect(
			providers[0]?.complete(req("user-1"), "system", []),
		).rejects.toBeInstanceOf(LlmUserRateLimitError);
		expect(create).toHaveBeenCalledTimes(1);
	});

	test("restores rolling quota from shared temporary state after restart", async () => {
		const store = createMemoryStore();
		const first = createLimiter({ defaultLimit: 1, store }).limiter;
		await first.assertAllowed(req("user-1"));

		const second = createLimiter({ defaultLimit: 1, store }).limiter;
		await expect(second.assertAllowed(req("user-1"))).rejects.toBeInstanceOf(
			LlmUserRateLimitError,
		);
	});

	test("refund after failure is visible to a restarted limiter on the same store", async () => {
		const store = createMemoryStore();
		const first = createLimiter({ defaultLimit: 1, store }).limiter;
		const providers = createLlmProviders(
			{ OPENAI_API_TOKEN: "sk-openai", OPENAI_MODEL: "gpt-test" },
			{},
			first,
		);
		const create = mock(async () => {
			throw new Error("provider down");
		});
		(
			providers[0] as unknown as {
				client: { chat: { completions: { create: typeof create } } };
			}
		).client = { chat: { completions: { create } } };

		await expect(
			providers[0]?.complete(req("user-1"), "s", []),
		).rejects.toThrow("provider down");

		const second = createLimiter({ defaultLimit: 1, store }).limiter;
		await second.assertAllowed(req("user-1"));
	});

	test("discards malformed temporary state entries", async () => {
		const store = createMemoryStore();
		store.data.set("llm:rate-limit:user-1", "not-an-array");
		const { limiter } = createLimiter({ defaultLimit: 1, store });
		await limiter.assertAllowed(req("user-1"));
	});
});
