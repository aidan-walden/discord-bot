import { describe, expect, mock, spyOn, test } from "bun:test";
import type {
	ActionRowBuilder,
	ButtonBuilder,
	EmbedBuilder,
	Message,
} from "discord.js";
import type Bot from "../models/Bot";
import type { MusicItem } from "../services/musicTypes";
import MusicLinkConvert from "./MusicLinkConvert";

const SPOTIFY_LINK = "https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6";

const sourceItem: MusicItem = {
	platform: "spotify",
	kind: "track",
	title: "Get Lucky",
	artist: "Daft Punk",
	isrc: "USQX91300108",
	url: SPOTIFY_LINK,
};
const targetItem: MusicItem = {
	platform: "apple",
	kind: "track",
	title: "Get Lucky",
	artist: "Daft Punk",
	isrc: "USQX91300108",
	url: "https://music.apple.com/us/album/get-lucky/1?i=2",
	artworkUrl: "https://img/512x512.jpg",
};

interface ReplyPayload {
	embeds: EmbedBuilder[];
	components: ActionRowBuilder<ButtonBuilder>[];
}

type CollectorHandlers = {
	collect?: (interaction: unknown) => Promise<void> | void;
	end?: (collected: unknown, reason: string) => Promise<void> | void;
};

function createReply() {
	const handlers: CollectorHandlers = {};
	const collector = {
		on(event: "collect" | "end", handler: (...args: never[]) => unknown) {
			handlers[event] = handler as never;
			return collector;
		},
		stop: mock(() => undefined),
	};
	const reply = {
		delete: mock(async () => undefined),
		edit: mock(async () => undefined),
		createMessageComponentCollector: mock(() => collector),
	};
	return { reply, collector, handlers };
}

function createMessage(options: {
	authorBot?: boolean;
	inGuild?: boolean;
	content?: string;
	reply?: ReturnType<typeof createReply>["reply"];
}): { message: Message; getPayload: () => ReplyPayload | undefined } {
	let payload: ReplyPayload | undefined;
	const message = {
		author: { bot: options.authorBot ?? false, id: "user-1" },
		content: options.content ?? SPOTIFY_LINK,
		inGuild: () => options.inGuild ?? true,
		reply: mock(async (arg: ReplyPayload) => {
			payload = arg;
			return options.reply ?? createReply().reply;
		}),
	} as unknown as Message;
	return { message, getPayload: () => payload };
}

function createBot(options: {
	available?: boolean;
	conversion?: { source: MusicItem; target: MusicItem } | null;
}): Bot {
	return {
		musicLinks: {
			isAvailable: mock(() => options.available ?? true),
			convert: mock(async () => options.conversion ?? null),
		},
	} as unknown as Bot;
}

describe("MusicLinkConvert", () => {
	test("ignores messages from bots", async () => {
		const bot = createBot({});
		const { message } = createMessage({ authorBot: true });
		await new MusicLinkConvert().execute(bot, message);
		expect(bot.musicLinks.convert).not.toHaveBeenCalled();
	});

	test("ignores messages outside a guild", async () => {
		const bot = createBot({});
		const { message } = createMessage({ inGuild: false });
		await new MusicLinkConvert().execute(bot, message);
		expect(bot.musicLinks.convert).not.toHaveBeenCalled();
	});

	test("does nothing when the converter is unavailable", async () => {
		const bot = createBot({ available: false });
		const { message } = createMessage({});
		await new MusicLinkConvert().execute(bot, message);
		expect(bot.musicLinks.convert).not.toHaveBeenCalled();
	});

	test("does nothing when the message has no music link", async () => {
		const bot = createBot({});
		const { message } = createMessage({ content: "no links here" });
		await new MusicLinkConvert().execute(bot, message);
		expect(bot.musicLinks.convert).not.toHaveBeenCalled();
	});

	test("does not reply when no conversion is found", async () => {
		const bot = createBot({ conversion: null });
		const { message } = createMessage({});
		await new MusicLinkConvert().execute(bot, message);
		expect(bot.musicLinks.convert).toHaveBeenCalledTimes(1);
		expect(message.reply).not.toHaveBeenCalled();
	});

	test("replies with an embed and a delete button", async () => {
		const bot = createBot({
			conversion: { source: sourceItem, target: targetItem },
		});
		const built = createReply();
		const { message, getPayload } = createMessage({ reply: built.reply });

		await new MusicLinkConvert().execute(bot, message);

		expect(message.reply).toHaveBeenCalledTimes(1);
		const payload = getPayload();
		const embed = payload?.embeds[0];
		expect(embed?.data.title).toBe("Get Lucky");
		expect(embed?.data.url).toBe(targetItem.url);
		expect(embed?.data.description).toBe("by Daft Punk");
		expect(embed?.data.thumbnail?.url).toBe(targetItem.artworkUrl);
		expect(embed?.data.footer?.text).toBe("Converted from Spotify");

		const button = payload?.components[0]?.components[0];
		const buttonData = button?.data as
			| { custom_id?: string; label?: string }
			| undefined;
		expect(buttonData?.custom_id).toBe("musiclink:delete");
		expect(buttonData?.label).toBe("🗑️");

		expect(built.reply.createMessageComponentCollector).toHaveBeenCalledTimes(
			1,
		);
	});

	test("deletes the reply when the button is clicked", async () => {
		const bot = createBot({
			conversion: { source: sourceItem, target: targetItem },
		});
		const built = createReply();
		const { message } = createMessage({ reply: built.reply });

		await new MusicLinkConvert().execute(bot, message);

		const deferUpdate = mock(async () => undefined);
		await built.handlers.collect?.({
			customId: "musiclink:delete",
			deferUpdate,
		});

		expect(deferUpdate).toHaveBeenCalledTimes(1);
		expect(built.reply.delete).toHaveBeenCalledTimes(1);
		expect(built.collector.stop).toHaveBeenCalledWith("deleted");
	});

	test("ignores clicks with an unrelated custom id", async () => {
		const bot = createBot({
			conversion: { source: sourceItem, target: targetItem },
		});
		const built = createReply();
		const { message } = createMessage({ reply: built.reply });

		await new MusicLinkConvert().execute(bot, message);
		await built.handlers.collect?.({
			customId: "something-else",
			deferUpdate: mock(async () => undefined),
		});

		expect(built.reply.delete).not.toHaveBeenCalled();
	});

	test("removes the button when it expires without a click", async () => {
		const bot = createBot({
			conversion: { source: sourceItem, target: targetItem },
		});
		const built = createReply();
		const { message } = createMessage({ reply: built.reply });

		await new MusicLinkConvert().execute(bot, message);
		await built.handlers.end?.([], "time");

		expect(built.reply.edit).toHaveBeenCalledWith({ components: [] });
	});

	test("does not edit the reply after a button-triggered deletion", async () => {
		const bot = createBot({
			conversion: { source: sourceItem, target: targetItem },
		});
		const built = createReply();
		const { message } = createMessage({ reply: built.reply });

		await new MusicLinkConvert().execute(bot, message);
		await built.handlers.end?.([], "deleted");

		expect(built.reply.edit).not.toHaveBeenCalled();
	});

	test("logs and stays silent when conversion throws", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(
			() => undefined,
		);
		const bot = {
			musicLinks: {
				isAvailable: mock(() => true),
				convert: mock(async () => {
					throw new Error("boom");
				}),
			},
		} as unknown as Bot;
		const { message } = createMessage({});

		await new MusicLinkConvert().execute(bot, message);

		expect(message.reply).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
