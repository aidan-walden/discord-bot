import { describe, expect, mock, test } from "bun:test";
import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";
import ChatSessionService from "./ChatSessionService";
import type { LlmMessage, LlmProvider, LlmRequestContext } from "./LlmProvider";

const SYSTEM_PROMPT = "You are a helpful assistant.";

type CompleteHandler = (
	system: string,
	messages: LlmMessage[],
) => Promise<string>;
type CompleteFn = (
	request: LlmRequestContext,
	system: string,
	messages: LlmMessage[],
) => Promise<string>;

function createProvider(
	name: LlmProvider["name"],
	complete: CompleteHandler,
): { provider: LlmProvider; complete: ReturnType<typeof mock<CompleteFn>> } {
	const completeMock = mock(
		async (
			_request: LlmRequestContext,
			system: string,
			messages: LlmMessage[],
		) => complete(system, messages),
	);
	return {
		provider: { name, label: name, complete: completeMock },
		complete: completeMock,
	};
}

function createTemporaryState() {
	const store = new Map<string, unknown>();
	const temporaryState = {
		store,
		get: async <T>(key: string): Promise<T | null> => {
			if (!store.has(key)) {
				return null;
			}
			return store.get(key) as T;
		},
		set: mock(async (key: string, value: unknown) => {
			store.set(key, value);
		}),
		delete: mock(async (key: string) => {
			store.delete(key);
		}),
	};
	return temporaryState as typeof temporaryState &
		Pick<TemporaryStateRepository, "get" | "set" | "delete">;
}

function makeHistoryMessage(index: number, offset = 0): LlmMessage {
	return {
		role: (index + offset) % 2 === 0 ? "user" : "assistant",
		content: `m${index + offset}`,
	};
}

function makeDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;

	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

describe("ChatSessionService", () => {
	test("reports availability based on configured providers", () => {
		const { provider } = createProvider("openai", async () => "ok");

		const withProviders = new ChatSessionService(
			[provider],
			createTemporaryState(),
		);
		expect(withProviders.isAvailable()).toBe(true);

		const withoutProviders = new ChatSessionService([], createTemporaryState());
		expect(withoutProviders.isAvailable()).toBe(false);
		expect(withoutProviders.getUnavailableReason()).toBe(
			"The AI assistant is unavailable because no LLM provider (OpenAI or Anthropic) is configured.",
		);
	});

	test("replaces existing session when same user starts new session in same root channel", async () => {
		const { provider } = createProvider("openai", async () => "ok");
		const temporaryState = createTemporaryState();
		const service = new ChatSessionService([provider], temporaryState);

		const firstSession = await service.createSession(
			"user-1",
			"root-1",
			"thread-1",
		);
		const secondSession = await service.createSession(
			"user-1",
			"root-1",
			"thread-2",
		);

		expect(service.getByThreadId("thread-1")).toBeUndefined();
		expect(service.getByRootChannel("user-1", "root-1")).toBe(secondSession);
		expect(service.getByThreadId("thread-2")).toBe(secondSession);
		expect(firstSession).not.toBe(secondSession);
		expect(secondSession.isBusy).toBe(false);
		expect(secondSession.messages).toEqual([]);
		expect(temporaryState.store.get("chat:sessions")).toEqual([
			{
				userId: "user-1",
				rootChannelId: "root-1",
				threadChannelId: "thread-2",
				messages: [],
			},
		]);
	});

	test("completeOnce sends system and user messages", async () => {
		let sentAt: { system: string; messages: LlmMessage[] } | undefined;
		const { provider, complete } = createProvider(
			"openai",
			async (system, messages) => {
				sentAt = { system, messages: structuredClone(messages) };
				return "rewritten";
			},
		);

		const service = new ChatSessionService([provider], createTemporaryState());
		const result = await service.completeOnce("user-1", "sys", "hello");

		expect(result).toBe("rewritten");
		expect(complete).toHaveBeenCalledTimes(1);
		expect(sentAt).toEqual({
			system: "sys",
			messages: [{ role: "user", content: "hello" }],
		});
	});

	test("completeOnce fails over and reports a credential rejection", async () => {
		const rejection = { status: 401, message: "Invalid API key" };
		const { provider: openai, complete: openaiComplete } = createProvider(
			"openai",
			async () => {
				throw rejection;
			},
		);
		const { provider: anthropic, complete: anthropicComplete } = createProvider(
			"anthropic",
			async () => "from anthropic",
		);
		const recordCredentialRejection = mock(() => undefined);
		const service = new ChatSessionService(
			[openai, anthropic],
			createTemporaryState(),
			{
				recordCredentialRejection,
			},
		);

		const result = await service.completeOnce("user-1", "sys", "hi");

		expect(result).toBe("from anthropic");
		expect(openaiComplete).toHaveBeenCalledTimes(1);
		expect(anthropicComplete).toHaveBeenCalledTimes(1);
		expect(recordCredentialRejection).toHaveBeenCalledWith("openai");
	});

	test("completes successful prompt lifecycle and persists history", async () => {
		let sentAt: { system: string; messages: LlmMessage[] } | undefined;
		const { provider, complete } = createProvider(
			"openai",
			async (system, messages) => {
				sentAt = { system, messages: structuredClone(messages) };
				return "Hello back.";
			},
		);

		const temporaryState = createTemporaryState();
		const service = new ChatSessionService([provider], temporaryState);
		const session = await service.createSession("user-1", "root-1", "thread-1");

		const result = await service.prompt(session, "Hello?");

		expect(result).toBe("Hello back.");
		expect(complete).toHaveBeenCalledTimes(1);
		expect(sentAt).toEqual({
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: "Hello?" }],
		});
		expect(session.isBusy).toBe(false);
		expect(session.messages).toEqual([
			{ role: "user", content: "Hello?" },
			{ role: "assistant", content: "Hello back." },
		]);
		expect(temporaryState.store.get("chat:sessions")).toEqual([
			{
				userId: "user-1",
				rootChannelId: "root-1",
				threadChannelId: "thread-1",
				messages: [
					{ role: "user", content: "Hello?" },
					{ role: "assistant", content: "Hello back." },
				],
			},
		]);
	});

	test("rolls back session when the provider returns an empty response", async () => {
		const { provider } = createProvider("openai", async () => "");
		const temporaryState = createTemporaryState();
		const service = new ChatSessionService([provider], temporaryState);
		const session = await service.createSession("user-1", "root-1", "thread-1");

		expect(service.prompt(session, "Hello?")).rejects.toThrow(
			"The AI assistant returned an empty response.",
		);

		expect(session.messages).toEqual([]);
		expect(session.isBusy).toBe(false);
		expect(temporaryState.store.get("chat:sessions")).toEqual([
			{
				userId: "user-1",
				rootChannelId: "root-1",
				threadChannelId: "thread-1",
				messages: [],
			},
		]);
	});

	test("rolls back newest user message when the provider call fails", async () => {
		const { provider } = createProvider("openai", async () => {
			throw new Error("provider exploded");
		});
		const temporaryState = createTemporaryState();
		const service = new ChatSessionService([provider], temporaryState);
		const session = await service.createSession("user-1", "root-1", "thread-1");
		session.messages = [
			{ role: "user", content: "old user" },
			{ role: "assistant", content: "old assistant" },
		];

		expect(service.prompt(session, "new user")).rejects.toThrow(
			"provider exploded",
		);

		expect(session.messages).toEqual([
			{ role: "user", content: "old user" },
			{ role: "assistant", content: "old assistant" },
		]);
		expect(session.isBusy).toBe(false);
		expect(temporaryState.store.get("chat:sessions")).toEqual([
			{
				userId: "user-1",
				rootChannelId: "root-1",
				threadChannelId: "thread-1",
				messages: [
					{ role: "user", content: "old user" },
					{ role: "assistant", content: "old assistant" },
				],
			},
		]);
	});

	test("fails over to the next provider on a credential rejection", async () => {
		const rejection = { status: 401, message: "Invalid API key" };
		const { provider: openai, complete: openaiComplete } = createProvider(
			"openai",
			async () => {
				throw rejection;
			},
		);
		const { provider: anthropic, complete: anthropicComplete } = createProvider(
			"anthropic",
			async () => "from anthropic",
		);
		const recordCredentialRejection = mock(() => undefined);
		const service = new ChatSessionService(
			[openai, anthropic],
			createTemporaryState(),
			{
				recordCredentialRejection,
			},
		);
		const session = await service.createSession("user-1", "root-1", "thread-1");

		const result = await service.prompt(session, "Hello?");

		expect(result).toBe("from anthropic");
		expect(openaiComplete).toHaveBeenCalledTimes(1);
		expect(anthropicComplete).toHaveBeenCalledTimes(1);
		expect(recordCredentialRejection).toHaveBeenCalledWith("openai");
		expect(session.messages).toEqual([
			{ role: "user", content: "Hello?" },
			{ role: "assistant", content: "from anthropic" },
		]);
	});

	test("records a rejection and rethrows when the only provider's key is rejected", async () => {
		const rejection = { status: 401, message: "Invalid API key" };
		const { provider } = createProvider("openai", async () => {
			throw rejection;
		});
		const recordCredentialRejection = mock(() => undefined);
		const service = new ChatSessionService([provider], createTemporaryState(), {
			recordCredentialRejection,
		});
		const session = await service.createSession("user-1", "root-1", "thread-1");

		expect(service.prompt(session, "Hello?")).rejects.toBe(rejection);
		expect(recordCredentialRejection).toHaveBeenCalledWith("openai");
		expect(session.messages).toEqual([]);
	});

	test("does not fail over on a plain rate-limit error", async () => {
		const { provider: openai, complete: openaiComplete } = createProvider(
			"openai",
			async () => {
				throw { status: 429, message: "Rate limited" };
			},
		);
		const { complete: anthropicComplete, provider: anthropic } = createProvider(
			"anthropic",
			async () => "should not run",
		);
		const recordCredentialRejection = mock(() => undefined);
		const service = new ChatSessionService(
			[openai, anthropic],
			createTemporaryState(),
			{
				recordCredentialRejection,
			},
		);
		const session = await service.createSession("user-1", "root-1", "thread-1");

		expect(service.prompt(session, "Hello?")).rejects.toEqual({
			status: 429,
			message: "Rate limited",
		});

		expect(openaiComplete).toHaveBeenCalledTimes(1);
		expect(anthropicComplete).not.toHaveBeenCalled();
		expect(recordCredentialRejection).not.toHaveBeenCalled();
	});

	test("fails over on an insufficient-quota 429", async () => {
		const { provider: openai } = createProvider("openai", async () => {
			throw { status: 429, code: "insufficient_quota" };
		});
		const { provider: anthropic, complete: anthropicComplete } = createProvider(
			"anthropic",
			async () => "from anthropic",
		);
		const recordCredentialRejection = mock(() => undefined);
		const service = new ChatSessionService(
			[openai, anthropic],
			createTemporaryState(),
			{
				recordCredentialRejection,
			},
		);
		const session = await service.createSession("user-1", "root-1", "thread-1");

		const result = await service.prompt(session, "Hello?");

		expect(result).toBe("from anthropic");
		expect(anthropicComplete).toHaveBeenCalledTimes(1);
		expect(recordCredentialRejection).toHaveBeenCalledWith("openai");
	});

	test("trims history before send and after the assistant response", async () => {
		let sentMessages: LlmMessage[] | undefined;
		const { provider } = createProvider("openai", async (_system, messages) => {
			sentMessages = structuredClone(messages);
			return "answer";
		});

		const service = new ChatSessionService([provider], createTemporaryState());
		const session = await service.createSession("user-1", "root-1", "thread-1");
		session.messages = Array.from({ length: 20 }, (_, index) =>
			makeHistoryMessage(index),
		);

		await service.prompt(session, "new-user");

		expect(sentMessages).toHaveLength(20);
		expect(sentMessages?.at(-1)).toEqual({ role: "user", content: "new-user" });

		expect(session.messages).toHaveLength(20);
		expect(session.messages.at(-1)).toEqual({
			role: "assistant",
			content: "answer",
		});
		expect(session.messages.at(-2)).toEqual({
			role: "user",
			content: "new-user",
		});
	});

	test("resets isBusy in finally after in-flight failure", async () => {
		const deferred = makeDeferred<string>();
		const { provider } = createProvider("openai", () => deferred.promise);

		const service = new ChatSessionService([provider], createTemporaryState());
		const session = await service.createSession("user-1", "root-1", "thread-1");

		const pending = service.prompt(session, "wait");

		expect(session.isBusy).toBe(true);

		deferred.reject(new Error("boom"));

		expect(pending).rejects.toThrow("boom");
		expect(session.isBusy).toBe(false);
	});

	test("rejects a concurrent prompt without queuing or double-calling the provider", async () => {
		const deferred = makeDeferred<string>();
		const { provider, complete } = createProvider(
			"openai",
			() => deferred.promise,
		);
		const service = new ChatSessionService([provider], createTemporaryState());
		const session = await service.createSession("user-1", "root-1", "thread-1");

		const first = service.prompt(session, "first");
		await Promise.resolve();
		expect(session.isBusy).toBe(true);

		await expect(service.prompt(session, "second")).rejects.toThrow(
			"Your previous message is still being processed!",
		);
		expect(complete).toHaveBeenCalledTimes(1);

		deferred.resolve("answer-1");
		await first;

		expect(session.isBusy).toBe(false);
		expect(complete).toHaveBeenCalledTimes(1);
		expect(session.messages).toEqual([
			{ role: "user", content: "first" },
			{ role: "assistant", content: "answer-1" },
		]);
	});

	test("initialize restores sessions with isBusy false and skips bad entries", async () => {
		const temporaryState = createTemporaryState();
		temporaryState.store.set("chat:sessions", [
			{
				userId: "user-1",
				rootChannelId: "root-1",
				threadChannelId: "thread-1",
				messages: [
					{ role: "user", content: "hi" },
					{ role: "assistant", content: "hello" },
					{ role: "system", content: "drop me" },
				],
			},
			{ userId: "incomplete" },
			null,
		]);
		const { provider } = createProvider("openai", async () => "ok");
		const service = new ChatSessionService([provider], temporaryState);

		await service.initialize();

		const session = service.getByThreadId("thread-1");
		expect(session).toEqual({
			userId: "user-1",
			rootChannelId: "root-1",
			threadChannelId: "thread-1",
			isBusy: false,
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "hello" },
			],
		});
		expect(service.getByRootChannel("user-1", "root-1")).toBe(session);
	});

	test("closeSession removes temporary snapshot when no sessions remain", async () => {
		const { provider } = createProvider("openai", async () => "ok");
		const temporaryState = createTemporaryState();
		const service = new ChatSessionService([provider], temporaryState);
		const session = await service.createSession("user-1", "root-1", "thread-1");

		await service.closeSession(session);

		expect(service.getByThreadId("thread-1")).toBeUndefined();
		expect(temporaryState.store.has("chat:sessions")).toBe(false);
	});

	test("serializes concurrent snapshot writes", async () => {
		const { provider } = createProvider("openai", async () => "ok");
		const temporaryState = createTemporaryState();
		let inflight = 0;
		let maxInflight = 0;
		temporaryState.set = mock(async (key: string, value: unknown) => {
			inflight += 1;
			maxInflight = Math.max(maxInflight, inflight);
			await Promise.resolve();
			temporaryState.store.set(key, value);
			inflight -= 1;
		});
		const service = new ChatSessionService([provider], temporaryState);

		await Promise.all([
			service.createSession("user-1", "root-1", "thread-1"),
			service.createSession("user-2", "root-2", "thread-2"),
			service.createSession("user-3", "root-3", "thread-3"),
		]);

		expect(maxInflight).toBe(1);
		expect(
			(temporaryState.store.get("chat:sessions") as unknown[]).length,
		).toBe(3);
	});

	test("concurrent creates for the same root leave one registered session", async () => {
		const { provider } = createProvider("openai", async () => "ok");
		const temporaryState = createTemporaryState();
		const service = new ChatSessionService([provider], temporaryState);

		const [first, second] = await Promise.all([
			service.createSession("user-1", "root-1", "thread-1"),
			service.createSession("user-1", "root-1", "thread-2"),
		]);

		const root = service.getByRootChannel("user-1", "root-1");
		expect(root).toBeDefined();
		if (!root) {
			throw new Error("expected root session");
		}
		expect(root === first || root === second).toBe(true);
		expect(service.getByThreadId(root.threadChannelId)).toBe(root);
		expect(
			service.getByThreadId("thread-1") === root ||
				service.getByThreadId("thread-2") === root,
		).toBe(true);
		if (root === second) {
			expect(service.getByThreadId("thread-1")).toBeUndefined();
			expect(service.getByThreadId("thread-2")).toBe(second);
		} else {
			expect(service.getByThreadId("thread-2")).toBeUndefined();
			expect(service.getByThreadId("thread-1")).toBe(first);
		}
		expect(temporaryState.store.get("chat:sessions")).toEqual([
			{
				userId: "user-1",
				rootChannelId: "root-1",
				threadChannelId: root.threadChannelId,
				messages: [],
			},
		]);
	});
});
