import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";
import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";
import {
	isCredentialFailure,
	type LlmMessage,
	type LlmProvider,
	type LlmRequestContext,
} from "./LlmProvider";

const SYSTEM_PROMPT = "You are a helpful assistant.";
const MAX_HISTORY_MESSAGES = 20;
const SESSIONS_KEY = "chat:sessions";

export type ChatSession = {
	userId: string;
	rootChannelId: string;
	threadChannelId: string;
	isBusy: boolean;
	messages: LlmMessage[];
};

type PersistedChatSession = {
	userId: string;
	rootChannelId: string;
	threadChannelId: string;
	messages: LlmMessage[];
};

type TemporaryStateStore = Pick<
	TemporaryStateRepository,
	"get" | "set" | "delete"
>;

function isLlmMessage(value: unknown): value is LlmMessage {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const message = value as Record<string, unknown>;
	return (
		(message.role === "user" || message.role === "assistant") &&
		typeof message.content === "string"
	);
}

function parsePersistedSession(value: unknown): PersistedChatSession | null {
	if (value === null || typeof value !== "object") {
		return null;
	}
	const entry = value as Record<string, unknown>;
	if (
		typeof entry.userId !== "string" ||
		entry.userId.length === 0 ||
		typeof entry.rootChannelId !== "string" ||
		entry.rootChannelId.length === 0 ||
		typeof entry.threadChannelId !== "string" ||
		entry.threadChannelId.length === 0 ||
		!Array.isArray(entry.messages)
	) {
		return null;
	}
	const messages = entry.messages.filter(isLlmMessage);
	return {
		userId: entry.userId,
		rootChannelId: entry.rootChannelId,
		threadChannelId: entry.threadChannelId,
		messages,
	};
}

export default class ChatSessionService {
	private readonly sessionsByThreadId = new Map<string, ChatSession>();
	private readonly sessionsByRootKey = new Map<string, ChatSession>();
	// ponytail: single write chain serializes snapshot updates; fine at one-bot scale.
	private persistQueue: Promise<void> = Promise.resolve();
	// ponytail: per-root create/close chain; fine at one-bot scale.
	private readonly rootQueues = new Map<string, Promise<unknown>>();

	constructor(
		private readonly providers: LlmProvider[],
		private readonly temporaryState: TemporaryStateStore,
		private readonly credentialReporter?: CredentialRejectionReporter,
	) {}

	/**
	 * Load chat sessions from temporary state. Restored sessions are never busy.
	 */
	async initialize(): Promise<void> {
		const snapshot = await this.temporaryState.get<unknown>(SESSIONS_KEY);
		if (!Array.isArray(snapshot)) {
			return;
		}

		for (const entry of snapshot) {
			const parsed = parsePersistedSession(entry);
			if (!parsed) {
				continue;
			}
			const session: ChatSession = {
				userId: parsed.userId,
				rootChannelId: parsed.rootChannelId,
				threadChannelId: parsed.threadChannelId,
				isBusy: false,
				messages: parsed.messages.slice(-MAX_HISTORY_MESSAGES),
			};
			this.sessionsByThreadId.set(session.threadChannelId, session);
			this.sessionsByRootKey.set(
				this.getRootKey(session.userId, session.rootChannelId),
				session,
			);
		}
	}

	isAvailable(): boolean {
		return this.providers.length > 0;
	}

	getUnavailableReason(): string {
		return "The AI assistant is unavailable because no LLM provider (OpenAI or Anthropic) is configured.";
	}

	getByThreadId(threadChannelId: string): ChatSession | undefined {
		return this.sessionsByThreadId.get(threadChannelId);
	}

	getByRootChannel(
		userId: string,
		rootChannelId: string,
	): ChatSession | undefined {
		return this.sessionsByRootKey.get(this.getRootKey(userId, rootChannelId));
	}

	async createSession(
		userId: string,
		rootChannelId: string,
		threadChannelId: string,
	): Promise<ChatSession> {
		const rootKey = this.getRootKey(userId, rootChannelId);
		return this.runExclusiveRoot(rootKey, async () => {
			const existingSession = this.sessionsByRootKey.get(rootKey);
			if (existingSession) {
				await this.unregisterSession(existingSession);
			}

			const session: ChatSession = {
				userId,
				rootChannelId,
				threadChannelId,
				isBusy: false,
				messages: [],
			};

			this.sessionsByThreadId.set(threadChannelId, session);
			this.sessionsByRootKey.set(rootKey, session);
			await this.persistSessions();
			return session;
		});
	}

	async closeSession(session: ChatSession): Promise<void> {
		const rootKey = this.getRootKey(session.userId, session.rootChannelId);
		await this.runExclusiveRoot(rootKey, async () => {
			await this.unregisterSession(session);
		});
	}

	async completeOnce(
		userId: string,
		systemPrompt: string,
		userMessage: string,
	): Promise<string> {
		if (this.providers.length === 0) {
			throw new Error(this.getUnavailableReason());
		}

		const request: LlmRequestContext = {
			userId,
			requestId: crypto.randomUUID(),
		};
		let lastError: unknown;
		for (const provider of this.providers) {
			try {
				const content = await provider.complete(request, systemPrompt, [
					{ role: "user", content: userMessage },
				]);
				if (!content) {
					throw new Error("The AI assistant returned an empty response.");
				}
				return content;
			} catch (error) {
				if (!isCredentialFailure(error)) {
					throw error;
				}
				this.credentialReporter?.recordCredentialRejection(provider.name);
				lastError = error;
			}
		}
		throw lastError ?? new Error("The AI assistant is unavailable.");
	}

	async prompt(session: ChatSession, input: string): Promise<string> {
		if (this.providers.length === 0) {
			throw new Error(this.getUnavailableReason());
		}
		if (session.isBusy) {
			throw new Error("Your previous message is still being processed!");
		}

		// Set busy synchronously before the first await so concurrent callers reject.
		session.isBusy = true;
		session.messages.push({ role: "user", content: input });
		this.trimSessionHistory(session);
		const request: LlmRequestContext = {
			userId: session.userId,
			requestId: crypto.randomUUID(),
		};

		try {
			let lastError: unknown;
			for (const provider of this.providers) {
				try {
					const content = await provider.complete(
						request,
						SYSTEM_PROMPT,
						session.messages,
					);
					if (!content) {
						throw new Error("The AI assistant returned an empty response.");
					}

					session.messages.push({ role: "assistant", content });
					this.trimSessionHistory(session);
					await this.persistSessions();
					return content;
				} catch (error) {
					// Only failover on credential/quota failures; anything else
					// (empty response, network) is surfaced immediately.
					if (!isCredentialFailure(error)) {
						throw error;
					}
					this.credentialReporter?.recordCredentialRejection(provider.name);
					lastError = error;
				}
			}
			throw lastError ?? new Error("The AI assistant is unavailable.");
		} catch (error) {
			const lastMessage = session.messages.at(-1);
			if (lastMessage?.role === "user" && lastMessage.content === input) {
				session.messages.pop();
			}
			await this.persistSessions();
			throw error;
		} finally {
			session.isBusy = false;
		}
	}

	private getRootKey(userId: string, rootChannelId: string): string {
		return `${userId}:${rootChannelId}`;
	}

	private trimSessionHistory(session: ChatSession): void {
		if (session.messages.length > MAX_HISTORY_MESSAGES) {
			session.messages = session.messages.slice(-MAX_HISTORY_MESSAGES);
		}
	}

	/** Drop maps for this session object only; no-op if already replaced. */
	private async unregisterSession(session: ChatSession): Promise<void> {
		const rootKey = this.getRootKey(session.userId, session.rootChannelId);
		const rootCurrent = this.sessionsByRootKey.get(rootKey);
		if (rootCurrent === session) {
			this.sessionsByRootKey.delete(rootKey);
		}
		const threadCurrent = this.sessionsByThreadId.get(session.threadChannelId);
		if (threadCurrent === session) {
			this.sessionsByThreadId.delete(session.threadChannelId);
		}
		if (rootCurrent === session || threadCurrent === session) {
			await this.persistSessions();
		}
	}

	private runExclusiveRoot<T>(
		rootKey: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const previous = this.rootQueues.get(rootKey) ?? Promise.resolve();
		const run = previous.then(fn, fn);
		this.rootQueues.set(
			rootKey,
			run.then(
				() => undefined,
				() => undefined,
			),
		);
		return run;
	}

	private persistSessions(): Promise<void> {
		const run = this.persistQueue.then(() => this.writeSessionsSnapshot());
		this.persistQueue = run.catch(() => undefined);
		return run;
	}

	private async writeSessionsSnapshot(): Promise<void> {
		const payload: PersistedChatSession[] = [
			...this.sessionsByThreadId.values(),
		].map((session) => ({
			userId: session.userId,
			rootChannelId: session.rootChannelId,
			threadChannelId: session.threadChannelId,
			messages: session.messages,
		}));
		if (payload.length === 0) {
			await this.temporaryState.delete(SESSIONS_KEY);
			return;
		}
		await this.temporaryState.set(SESSIONS_KEY, payload);
	}
}
