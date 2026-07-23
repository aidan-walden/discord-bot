import { describe, expect, mock, test } from "bun:test";
import ChatSessionService from "./ChatSessionService";
import type { LlmMessage, LlmProvider } from "./LlmProvider";

const SYSTEM_PROMPT = "You are a helpful assistant.";

type CompleteFn = (system: string, messages: LlmMessage[]) => Promise<string>;

function createProvider(
	name: LlmProvider["name"],
	complete: CompleteFn,
): { provider: LlmProvider; complete: ReturnType<typeof mock<CompleteFn>> } {
	const completeMock = mock(complete);
	return {
		provider: { name, label: name, complete: completeMock },
		complete: completeMock,
	};
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

		const withProviders = new ChatSessionService([provider]);
		expect(withProviders.isAvailable()).toBe(true);

		const withoutProviders = new ChatSessionService([]);
		expect(withoutProviders.isAvailable()).toBe(false);
		expect(withoutProviders.getUnavailableReason()).toBe(
			"The AI assistant is unavailable because no LLM provider (OpenAI or Anthropic) is configured.",
		);
	});

	test("replaces existing session when same user starts new session in same root channel", () => {
		const { provider } = createProvider("openai", async () => "ok");
		const service = new ChatSessionService([provider]);

		const firstSession = service.createSession("user-1", "root-1", "thread-1");
		const secondSession = service.createSession("user-1", "root-1", "thread-2");

		expect(service.getByThreadId("thread-1")).toBeUndefined();
		expect(service.getByRootChannel("user-1", "root-1")).toBe(secondSession);
		expect(service.getByThreadId("thread-2")).toBe(secondSession);
		expect(firstSession).not.toBe(secondSession);
		expect(secondSession.isBusy).toBe(false);
		expect(secondSession.messages).toEqual([]);
	});

	test("completes successful prompt lifecycle", async () => {
		let sentAt: { system: string; messages: LlmMessage[] } | undefined;
		const { provider, complete } = createProvider(
			"openai",
			async (system, messages) => {
				sentAt = { system, messages: structuredClone(messages) };
				return "Hello back.";
			},
		);

		const service = new ChatSessionService([provider]);
		const session = service.createSession("user-1", "root-1", "thread-1");

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
	});

	test("rolls back session when the provider returns an empty response", async () => {
		const { provider } = createProvider("openai", async () => "");
		const service = new ChatSessionService([provider]);
		const session = service.createSession("user-1", "root-1", "thread-1");

		expect(service.prompt(session, "Hello?")).rejects.toThrow(
			"The AI assistant returned an empty response.",
		);

		expect(session.messages).toEqual([]);
		expect(session.isBusy).toBe(false);
	});

	test("rolls back newest user message when the provider call fails", async () => {
		const { provider } = createProvider("openai", async () => {
			throw new Error("provider exploded");
		});
		const service = new ChatSessionService([provider]);
		const session = service.createSession("user-1", "root-1", "thread-1");
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
		const service = new ChatSessionService([openai, anthropic], {
			recordCredentialRejection,
		});
		const session = service.createSession("user-1", "root-1", "thread-1");

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
		const service = new ChatSessionService([provider], {
			recordCredentialRejection,
		});
		const session = service.createSession("user-1", "root-1", "thread-1");

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
		const service = new ChatSessionService([openai, anthropic], {
			recordCredentialRejection,
		});
		const session = service.createSession("user-1", "root-1", "thread-1");

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
		const service = new ChatSessionService([openai, anthropic], {
			recordCredentialRejection,
		});
		const session = service.createSession("user-1", "root-1", "thread-1");

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

		const service = new ChatSessionService([provider]);
		const session = service.createSession("user-1", "root-1", "thread-1");
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

		const service = new ChatSessionService([provider]);
		const session = service.createSession("user-1", "root-1", "thread-1");

		const pending = service.prompt(session, "wait");

		expect(session.isBusy).toBe(true);

		deferred.reject(new Error("boom"));

		expect(pending).rejects.toThrow("boom");
		expect(session.isBusy).toBe(false);
	});
});
