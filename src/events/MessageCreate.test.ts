import { describe, expect, mock, spyOn, test } from "bun:test";
import type { Message } from "discord.js";
import type Bot from "../models/Bot";
import type { ChatSession } from "../services/ChatSessionService";
import MessageCreate from "./MessageCreate";

type ChannelOptions = {
	isThread?: boolean;
	archived?: boolean;
	locked?: boolean;
};

function createChannel(options: ChannelOptions = {}) {
	return {
		id: "thread-1",
		archived: options.archived ?? false,
		locked: options.locked ?? false,
		isThread: () => options.isThread ?? true,
		send: mock(async () => undefined),
		sendTyping: mock(async () => undefined),
	};
}

function createMessage(options: {
	authorBot?: boolean;
	authorId?: string;
	inGuild?: boolean;
	content?: string;
	channel?: ReturnType<typeof createChannel>;
}): Message {
	return {
		author: {
			bot: options.authorBot ?? false,
			id: options.authorId ?? "user-1",
		},
		content: options.content ?? "hello",
		inGuild: () => options.inGuild ?? true,
		channel: options.channel ?? createChannel(),
		reply: mock(async () => undefined),
	} as unknown as Message;
}

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
	return {
		userId: "user-1",
		rootChannelId: "root-1",
		threadChannelId: "thread-1",
		isBusy: false,
		messages: [],
		...overrides,
	};
}

function createBot(options: {
	session?: ChatSession | undefined;
	banned?: boolean;
	available?: boolean;
	prompt?: () => Promise<string>;
}): Bot {
	return {
		chatSessions: {
			getByThreadId: mock(() => options.session),
			closeSession: mock(() => undefined),
			isAvailable: mock(() => options.available ?? true),
			getUnavailableReason: mock(() => "unavailable"),
			prompt: mock(options.prompt ?? (async () => "response")),
		},
		permissions: {
			isGptUserBanned: mock(async () => options.banned ?? false),
		},
		config: { get: mock(() => "owner-1") },
	} as unknown as Bot;
}

describe("MessageCreate", () => {
	test("ignores messages from bots", async () => {
		const bot = createBot({ session: createSession() });
		const message = createMessage({ authorBot: true });

		await new MessageCreate().execute(bot, message);

		expect(bot.chatSessions.getByThreadId).not.toHaveBeenCalled();
	});

	test("ignores messages outside a guild", async () => {
		const bot = createBot({ session: createSession() });
		const message = createMessage({ inGuild: false });

		await new MessageCreate().execute(bot, message);

		expect(bot.chatSessions.getByThreadId).not.toHaveBeenCalled();
	});

	test("ignores messages outside a thread", async () => {
		const bot = createBot({ session: createSession() });
		const message = createMessage({
			channel: createChannel({ isThread: false }),
		});

		await new MessageCreate().execute(bot, message);

		expect(bot.chatSessions.getByThreadId).not.toHaveBeenCalled();
	});

	test("does nothing when there is no session for the thread", async () => {
		const bot = createBot({ session: undefined });
		const message = createMessage({});

		await new MessageCreate().execute(bot, message);

		expect(bot.chatSessions.closeSession).not.toHaveBeenCalled();
		expect(message.reply).not.toHaveBeenCalled();
	});

	test("closes the session when the thread is archived", async () => {
		const session = createSession();
		const bot = createBot({ session });
		const message = createMessage({
			channel: createChannel({ archived: true }),
		});

		await new MessageCreate().execute(bot, message);

		expect(bot.chatSessions.closeSession).toHaveBeenCalledWith(session);
	});

	test("closes the session when the thread is locked", async () => {
		const session = createSession();
		const bot = createBot({ session });
		const message = createMessage({ channel: createChannel({ locked: true }) });

		await new MessageCreate().execute(bot, message);

		expect(bot.chatSessions.closeSession).toHaveBeenCalledWith(session);
	});

	test("ignores messages from a user who does not own the session", async () => {
		const bot = createBot({ session: createSession({ userId: "owner" }) });
		const message = createMessage({ authorId: "intruder" });

		await new MessageCreate().execute(bot, message);

		expect(bot.permissions.isGptUserBanned).not.toHaveBeenCalled();
	});

	test("ignores empty prompts", async () => {
		const bot = createBot({ session: createSession() });
		const message = createMessage({ content: "   " });

		await new MessageCreate().execute(bot, message);

		expect(bot.permissions.isGptUserBanned).not.toHaveBeenCalled();
	});

	test("closes the session and warns when the user is GPT-banned", async () => {
		const session = createSession();
		const bot = createBot({ session, banned: true });
		const message = createMessage({});

		await new MessageCreate().execute(bot, message);

		expect(bot.chatSessions.closeSession).toHaveBeenCalledWith(session);
		expect(message.reply).toHaveBeenCalledWith(
			"You're banned from using the AI assistant.",
		);
	});

	test("replies with the unavailable reason when sessions are unavailable", async () => {
		const bot = createBot({ session: createSession(), available: false });
		const message = createMessage({});

		await new MessageCreate().execute(bot, message);

		expect(message.reply).toHaveBeenCalledWith("unavailable");
		expect(bot.chatSessions.prompt).not.toHaveBeenCalled();
	});

	test("replies when the session is still busy", async () => {
		const bot = createBot({ session: createSession({ isBusy: true }) });
		const message = createMessage({});

		await new MessageCreate().execute(bot, message);

		expect(message.reply).toHaveBeenCalledWith(
			"Your previous message is still being processed!",
		);
		expect(bot.chatSessions.prompt).not.toHaveBeenCalled();
	});

	test("prompts and sends the response on the happy path", async () => {
		const session = createSession();
		const bot = createBot({ session, prompt: async () => "the answer" });
		const channel = createChannel();
		const message = createMessage({ channel });

		await new MessageCreate().execute(bot, message);

		expect(channel.sendTyping).toHaveBeenCalledTimes(1);
		expect(bot.chatSessions.prompt).toHaveBeenCalledWith(session, "hello");
		expect(channel.send).toHaveBeenCalledWith({
			content: "the answer",
			allowedMentions: { parse: [] },
		});
	});

	test("replies with an owner mention when the prompt throws", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(
			() => undefined,
		);
		const bot = createBot({
			session: createSession(),
			prompt: async () => {
				throw new Error("boom");
			},
		});
		const message = createMessage({});

		await new MessageCreate().execute(bot, message);

		expect(message.reply).toHaveBeenCalledWith(
			"The AI assistant failed to respond. Please contact <@owner-1>",
		);
		errorSpy.mockRestore();
	});
});
