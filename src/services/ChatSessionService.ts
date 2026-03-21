import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions";

const SYSTEM_PROMPT = "You are a helpful assistant.";
const MAX_HISTORY_MESSAGES = 20;

export type ChatSession = {
	userId: string;
	rootChannelId: string;
	threadChannelId: string;
	isBusy: boolean;
	messages: ChatCompletionMessageParam[];
};

export default class ChatSessionService {
	private readonly sessionsByThreadId = new Map<string, ChatSession>();
	private readonly sessionsByRootKey = new Map<string, ChatSession>();

	constructor(
		private readonly openai: OpenAI | null,
		private readonly model: string | undefined,
	) {}

	isAvailable(): boolean {
		return this.openai !== null && Boolean(this.model);
	}

	getUnavailableReason(): string {
		if (!this.openai) {
			return "ChatGPT is unavailable because OPENAI_API_TOKEN is not configured.";
		}

		if (!this.model) {
			return "ChatGPT is unavailable because OPENAI_MODEL is not configured.";
		}

		return "ChatGPT is unavailable.";
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
			messages: [{ role: "system", content: SYSTEM_PROMPT }],
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

	closeSessionByThreadId(threadChannelId: string): void {
		const session = this.sessionsByThreadId.get(threadChannelId);
		if (!session) {
			return;
		}

		this.closeSession(session);
	}

	async prompt(session: ChatSession, input: string): Promise<string> {
		if (!this.openai || !this.model) {
			throw new Error(this.getUnavailableReason());
		}

		session.isBusy = true;
		session.messages.push({ role: "user", content: input });
		this.trimSessionHistory(session);

		try {
			const completion = await this.openai.chat.completions.create({
				model: this.model,
				messages: session.messages,
			});
			const content = completion.choices[0]?.message.content?.trim();
			if (!content) {
				throw new Error("ChatGPT returned an empty response.");
			}

			session.messages.push({ role: "assistant", content });
			this.trimSessionHistory(session);
			return content;
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
		if (session.messages.length <= MAX_HISTORY_MESSAGES + 1) {
			return;
		}

		session.messages = [
			session.messages[0] ?? { role: "system", content: SYSTEM_PROMPT },
			...session.messages.slice(-MAX_HISTORY_MESSAGES),
		];
	}
}
