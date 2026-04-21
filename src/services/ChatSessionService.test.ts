import { describe, expect, mock, test } from "bun:test";
import type OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions/completions";
import ChatSessionService from "./ChatSessionService";

function createOpenAiMock() {
	const create = mock((_request: { model: string; messages: unknown[] }) =>
		Promise.resolve({ choices: [] } as unknown as ChatCompletion),
	);
	const openai = {
		chat: {
			completions: {
				create,
			},
		},
	} as unknown as OpenAI;

	return { create, openai };
}

function makeCompletion(content: string | null | undefined) {
	return { choices: [{ message: { content } }] } as unknown as ChatCompletion;
}

function makeHistoryMessage(index: number, offset = 1) {
	return {
		role: ((index + offset) % 2 === 0 ? "user" : "assistant") as
			| "user"
			| "assistant",
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
	test("reports availability and unavailable reasons for constructor combinations", () => {
		const { openai } = createOpenAiMock();

		const cases = [
			{
				openai: null,
				model: undefined,
				isAvailable: false,
				reason:
					"ChatGPT is unavailable because OPENAI_API_TOKEN is not configured.",
			},
			{
				openai,
				model: undefined,
				isAvailable: false,
				reason:
					"ChatGPT is unavailable because OPENAI_MODEL is not configured.",
			},
			{
				openai,
				model: "gpt-test",
				isAvailable: true,
				reason: "ChatGPT is unavailable.",
			},
		] as const;

		for (const testCase of cases) {
			const service = new ChatSessionService(testCase.openai, testCase.model);

			expect(service.isAvailable()).toBe(testCase.isAvailable);
			expect(service.getUnavailableReason()).toBe(testCase.reason);
		}
	});

	test("replaces existing session when same user starts new session in same root channel", () => {
		const { openai } = createOpenAiMock();
		const service = new ChatSessionService(openai, "gpt-test");

		const firstSession = service.createSession("user-1", "root-1", "thread-1");
		const secondSession = service.createSession("user-1", "root-1", "thread-2");

		expect(service.getByThreadId("thread-1")).toBeUndefined();
		expect(service.getByRootChannel("user-1", "root-1")).toBe(secondSession);
		expect(service.getByThreadId("thread-2")).toBe(secondSession);
		expect(firstSession).not.toBe(secondSession);
		expect(secondSession.isBusy).toBe(false);
		expect(secondSession.messages).toEqual([
			{ role: "system", content: "You are a helpful assistant." },
		]);
	});

	test("closes session by thread id and ignores missing thread ids", () => {
		const { openai } = createOpenAiMock();
		const service = new ChatSessionService(openai, "gpt-test");

		const session = service.createSession("user-1", "root-1", "thread-1");
		const unrelatedSession = service.createSession(
			"user-2",
			"root-2",
			"thread-2",
		);

		service.closeSessionByThreadId(session.threadChannelId);

		expect(service.getByThreadId(session.threadChannelId)).toBeUndefined();
		expect(
			service.getByRootChannel(session.userId, session.rootChannelId),
		).toBeUndefined();

		expect(() =>
			service.closeSessionByThreadId("missing-thread"),
		).not.toThrow();
		expect(service.getByThreadId(unrelatedSession.threadChannelId)).toBe(
			unrelatedSession,
		);
		expect(
			service.getByRootChannel(
				unrelatedSession.userId,
				unrelatedSession.rootChannelId,
			),
		).toBe(unrelatedSession);
	});

	test("completes successful prompt lifecycle", async () => {
		const { create, openai } = createOpenAiMock();
		let requestAtSend:
			| {
					model: string;
					messages: unknown[];
			  }
			| undefined;
		create.mockImplementationOnce(
			async (request: { model: string; messages: unknown[] }) => {
				requestAtSend = {
					model: request.model,
					messages: structuredClone(request.messages),
				};
				return makeCompletion("  Hello back.  ");
			},
		);

		const service = new ChatSessionService(openai, "gpt-test");
		const session = service.createSession("user-1", "root-1", "thread-1");

		const result = await service.prompt(session, "Hello?");

		expect(result).toBe("Hello back.");
		expect(create).toHaveBeenCalledTimes(1);
		expect(requestAtSend).toEqual({
			model: "gpt-test",
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello?" },
			],
		});
		expect(session.isBusy).toBe(false);
		expect(session.messages).toEqual([
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Hello?" },
			{ role: "assistant", content: "Hello back." },
		]);
	});

	test("rolls back session when OpenAI returns empty response", async () => {
		const { create, openai } = createOpenAiMock();
		create.mockResolvedValueOnce(makeCompletion("   "));

		const service = new ChatSessionService(openai, "gpt-test");
		const session = service.createSession("user-1", "root-1", "thread-1");

		expect(service.prompt(session, "Hello?")).rejects.toThrow(
			"ChatGPT returned an empty response.",
		);

		expect(session.messages).toEqual([
			{ role: "system", content: "You are a helpful assistant." },
		]);
		expect(session.isBusy).toBe(false);
	});

	test("rolls back newest user message when OpenAI call fails", async () => {
		const { create, openai } = createOpenAiMock();
		create.mockRejectedValueOnce(new Error("OpenAI exploded"));

		const service = new ChatSessionService(openai, "gpt-test");
		const session = service.createSession("user-1", "root-1", "thread-1");
		session.messages = [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "old user" },
			{ role: "assistant", content: "old assistant" },
		];

		expect(service.prompt(session, "new user")).rejects.toThrow(
			"OpenAI exploded",
		);

		expect(session.messages).toEqual([
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "old user" },
			{ role: "assistant", content: "old assistant" },
		]);
		expect(session.isBusy).toBe(false);
	});

	test("trims history before send and after assistant response", async () => {
		const { create, openai } = createOpenAiMock();
		let sentMessages: unknown[] | undefined;
		create.mockImplementationOnce(async (request: { messages: unknown[] }) => {
			sentMessages = structuredClone(request.messages);
			return makeCompletion("answer");
		});

		const service = new ChatSessionService(openai, "gpt-test");
		const session = service.createSession("user-1", "root-1", "thread-1");
		session.messages = [
			{ role: "system", content: "You are a helpful assistant." },
			...Array.from({ length: 20 }, (_, index) => makeHistoryMessage(index)),
		];

		await service.prompt(session, "new-user");

		expect(sentMessages).toHaveLength(21);
		expect(sentMessages?.[0]).toEqual({
			role: "system",
			content: "You are a helpful assistant.",
		});
		expect(sentMessages?.slice(1)).toEqual([
			...Array.from({ length: 19 }, (_, index) => makeHistoryMessage(index, 2)),
			{ role: "user", content: "new-user" },
		]);

		expect(session.messages).toHaveLength(21);
		expect(session.messages[0]).toEqual({
			role: "system",
			content: "You are a helpful assistant.",
		});
		expect(session.messages.slice(1)).toEqual([
			...Array.from({ length: 18 }, (_, index) => makeHistoryMessage(index, 3)),
			{ role: "user", content: "new-user" },
			{ role: "assistant", content: "answer" },
		]);
	});

	test("resets isBusy in finally after in-flight failure", async () => {
		const { create, openai } = createOpenAiMock();
		const deferred = makeDeferred<ChatCompletion>();
		create.mockImplementationOnce(() => deferred.promise);

		const service = new ChatSessionService(openai, "gpt-test");
		const session = service.createSession("user-1", "root-1", "thread-1");

		const pending = service.prompt(session, "wait");

		expect(session.isBusy).toBe(true);

		deferred.reject(new Error("boom"));

		expect(pending).rejects.toThrow("boom");
		expect(session.isBusy).toBe(false);
	});
});
