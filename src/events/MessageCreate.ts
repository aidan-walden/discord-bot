import {
	type ClientEvents,
	Events,
	type Message,
	userMention,
} from "discord.js";
import { sendLongMessage } from "../helpers/sendLongMessage";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";

export default class MessageCreate implements BotEvent {
	once = false;
	event: keyof ClientEvents = Events.MessageCreate;

	async execute(bot: Bot, message: Message): Promise<void> {
		if (
			message.author.bot ||
			!message.inGuild() ||
			!message.channel.isThread()
		) {
			return;
		}

		const session = bot.chatSessions.getByThreadId(message.channel.id);
		if (!session) {
			return;
		}

		if (message.channel.archived || message.channel.locked) {
			bot.chatSessions.closeSession(session);
			return;
		}

		if (session.userId !== message.author.id) {
			return;
		}

		const prompt = message.content.trim();
		if (prompt.length === 0) {
			return;
		}

		if (await bot.permissions.isGptUserBanned(message.author.id)) {
			bot.chatSessions.closeSession(session);
			await message.reply("You're banned from using the AI assistant.");
			return;
		}

		if (!bot.chatSessions.isAvailable()) {
			await message.reply(bot.chatSessions.getUnavailableReason());
			return;
		}

		if (session.isBusy) {
			await message.reply("Your previous message is still being processed!");
			return;
		}

		try {
			await message.channel.sendTyping();
			const response = await bot.chatSessions.prompt(session, prompt);
			await sendLongMessage(message.channel, response, {}, false);
		} catch (error) {
			console.error("AI assistant thread response failed:", error);
			await message.reply(
				`The AI assistant failed to respond. Please contact ${userMention(bot.config.get("BOT_OWNER_ID"))}`,
			);
		}
	}
}
