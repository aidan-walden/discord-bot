import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";
import {
	isCredentialFailure,
	type LlmMessage,
	type LlmProvider,
} from "./LlmProvider";

const SYSTEM_PROMPT = "You are a helpful assistant.";
const MAX_HISTORY_MESSAGES = 20;

export type ChatSession = {
	userId: string;
	rootChannelId: string;
	threadChannelId: string;
	isBusy: boolean;
	messages: LlmMessage[];
};

export default class ChatSessionService {
	private readonly sessionsByThreadId = new Map<string, ChatSession>();
	private readonly sessionsByRootKey = new Map<string, ChatSession>();

	constructor(
		private readonly providers: LlmProvider[],
		private readonly credentialReporter?: CredentialRejectionReporter,
	) {}

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

	createSession(
		userId: string,
		rootChannelId: string,
		threadChannelId: string,
	): ChatSession {
		const existingSession = this.getByRootChannel(userId, rootChannelId);
		if (existingSession) {
			this.closeSession(existingSession);
		}

		const session: ChatSession = {
			userId,
			rootChannelId,
			threadChannelId,
			isBusy: false,
			messages: [],
		};

		this.sessionsByThreadId.set(threadChannelId, session);
		this.sessionsByRootKey.set(this.getRootKey(userId, rootChannelId), session);
		return session;
	}

	closeSession(session: ChatSession): void {
		this.sessionsByThreadId.delete(session.threadChannelId);
		this.sessionsByRootKey.delete(
			this.getRootKey(session.userId, session.rootChannelId),
		);
	}

	async prompt(session: ChatSession, input: string): Promise<string> {
		if (this.providers.length === 0) {
			throw new Error(this.getUnavailableReason());
		}

		session.isBusy = true;
		session.messages.push({ role: "user", content: input });
		this.trimSessionHistory(session);

		try {
			let lastError: unknown;
			for (const provider of this.providers) {
				try {
					const content = await provider.complete(
						SYSTEM_PROMPT,
						session.messages,
					);
					if (!content) {
						throw new Error("The AI assistant returned an empty response.");
					}

					session.messages.push({ role: "assistant", content });
					this.trimSessionHistory(session);
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
}
