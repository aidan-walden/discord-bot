import { describe, expect, mock, spyOn, test } from "bun:test";
import { type ChatInputCommandInteraction, TextChannel } from "discord.js";
import type { ChatSession } from "../../services/ChatSessionService";
import ChatGpt from "./chatgpt";

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

function createThreadChannel(overrides: Record<string, unknown> = {}) {
	return {
		id: "thread-1",
		parentId: "root-1",
		isThread: () => true,
		send: mock(async () => undefined),
		sendTyping: mock(async () => undefined),
		...overrides,
	};
}

function createTextChannel(overrides: Record<string, unknown> = {}) {
	const channel = Object.create(TextChannel.prototype);
	Object.assign(channel, {
		id: "root-1",
		isThread: () => false,
		send: mock(async () => ({
			startThread: mock(async () => createThreadChannel()),
		})),
		...overrides,
	});
	return channel;
}

type SessionsDouble = {
	isAvailable?: boolean;
	unavailableReason?: string;
	byThreadId?: ChatSession | undefined;
	byRootChannel?: ChatSession | undefined;
	prompt?: () => Promise<string>;
};

function createInteraction(options: {
	subcommand?: "ask" | "end";
	prompt?: string;
	channel?: unknown;
	userId?: string;
	banned?: boolean;
	sessions?: SessionsDouble;
	fetchChannel?: () => Promise<unknown>;
}) {
	const sessions = options.sessions ?? {};
	const chatSessions = {
		isAvailable: mock(() => sessions.isAvailable ?? true),
		getUnavailableReason: mock(
			() => sessions.unavailableReason ?? "unavailable",
		),
		getByThreadId: mock(() => sessions.byThreadId),
		getByRootChannel: mock(() => sessions.byRootChannel),
		createSession: mock((userId: string) => createSession({ userId })),
		closeSession: mock(() => undefined),
		prompt: mock(sessions.prompt ?? (async () => "response")),
	};
	const interaction = {
		user: {
			id: options.userId ?? "user-1",
			username: "tester",
			tag: "tester#1",
			toString: () => "<@user-1>",
		},
		channel: "channel" in options ? options.channel : createThreadChannel(),
		options: {
			getSubcommand: mock(() => options.subcommand ?? "ask"),
			getString: mock(() => options.prompt ?? "hello"),
		},
		deferReply: mock(async () => undefined),
		editReply: mock(async () => undefined),
		client: {
			bot: {
				chatSessions,
				permissions: {
					isGptUserBanned: mock(async () => options.banned ?? false),
				},
				config: { get: mock(() => "owner-1") },
			},
			channels: { fetch: mock(options.fetchChannel ?? (async () => null)) },
		},
	} as unknown as ChatInputCommandInteraction;
	return { interaction, chatSessions };
}

describe("ChatGpt handleAsk", () => {
	test("rejects banned users", async () => {
		const { interaction } = createInteraction({ banned: true });
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"You're banned from using the AI assistant.",
		);
	});

	test("rejects when there is no channel", async () => {
		const { interaction } = createInteraction({ channel: null });
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"This command can only be used in a text channel.",
		);
	});

	test("rejects an empty prompt", async () => {
		const { interaction } = createInteraction({ prompt: "   " });
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"Please provide a prompt.",
		);
	});

	test("reports the unavailable reason", async () => {
		const { interaction } = createInteraction({
			sessions: { isAvailable: false, unavailableReason: "down" },
		});
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith("down");
	});

	test("rejects a thread session owned by another user", async () => {
		const { interaction } = createInteraction({
			sessions: { byThreadId: createSession({ userId: "someone-else" }) },
		});
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"That AI assistant session belongs to another user.",
		);
	});

	test("creates a session in a thread without one", async () => {
		const { interaction, chatSessions } = createInteraction({
			sessions: { byThreadId: undefined },
		});
		await new ChatGpt().execute(interaction);
		expect(chatSessions.createSession).toHaveBeenCalledWith(
			"user-1",
			"root-1",
			"thread-1",
		);
		expect(chatSessions.prompt).toHaveBeenCalled();
	});

	test("recreates the thread when the managed thread is stale", async () => {
		const staleSession = createSession({ threadChannelId: "gone" });
		const { interaction, chatSessions } = createInteraction({
			channel: createTextChannel(),
			sessions: { byRootChannel: staleSession },
			fetchChannel: async () => null, // fetchManagedThread returns null
		});
		await new ChatGpt().execute(interaction);
		expect(chatSessions.closeSession).toHaveBeenCalledWith(staleSession);
		expect(chatSessions.createSession).toHaveBeenCalled();
	});

	test("starts a new thread from a text channel without a session", async () => {
		const text = createTextChannel();
		const { interaction, chatSessions } = createInteraction({
			channel: text,
			sessions: { byRootChannel: undefined },
		});
		await new ChatGpt().execute(interaction);
		expect(text.send).toHaveBeenCalled();
		expect(chatSessions.createSession).toHaveBeenCalled();
		expect(chatSessions.prompt).toHaveBeenCalled();
	});

	test("rejects when the channel is neither a thread nor a text channel", async () => {
		const { interaction } = createInteraction({
			channel: { isThread: () => false },
			sessions: { byRootChannel: undefined },
		});
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"AI assistant sessions can only be started from a server.",
		);
	});

	test("rejects when the session is busy", async () => {
		const { interaction } = createInteraction({
			sessions: { byThreadId: createSession({ isBusy: true }) },
		});
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			expect.stringContaining("still processing"),
		);
	});

	test("warns in the thread when the prompt throws", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(
			() => undefined,
		);
		const thread = createThreadChannel();
		const { interaction } = createInteraction({
			channel: thread,
			sessions: {
				byThreadId: createSession(),
				prompt: async () => {
					throw new Error("boom");
				},
			},
		});
		await new ChatGpt().execute(interaction);
		expect(thread.send).toHaveBeenCalledWith(
			"The AI assistant failed to respond. Please contact <@owner-1>",
		);
		errorSpy.mockRestore();
	});
});

describe("ChatGpt handleEnd", () => {
	test("rejects when there is no channel", async () => {
		const { interaction } = createInteraction({
			subcommand: "end",
			channel: null,
		});
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"This command can only be used in a text channel.",
		);
	});

	test("reports when there is no active session", async () => {
		const { interaction } = createInteraction({
			subcommand: "end",
			sessions: { byThreadId: undefined },
		});
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"You do not have an active AI assistant session in this channel.",
		);
	});

	test("rejects a session owned by another user", async () => {
		const { interaction } = createInteraction({
			subcommand: "end",
			sessions: { byThreadId: createSession({ userId: "someone-else" }) },
		});
		await new ChatGpt().execute(interaction);
		expect(interaction.editReply).toHaveBeenCalledWith(
			"That AI assistant session belongs to another user.",
		);
	});

	test("closes the session and reports success", async () => {
		const session = createSession();
		const thread = createThreadChannel();
		const { interaction, chatSessions } = createInteraction({
			subcommand: "end",
			sessions: { byThreadId: session },
			fetchChannel: async () => thread,
		});
		await new ChatGpt().execute(interaction);
		expect(chatSessions.closeSession).toHaveBeenCalledWith(session);
		expect(thread.send).toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledWith(
			"Ended your active AI assistant session.",
		);
	});
});
