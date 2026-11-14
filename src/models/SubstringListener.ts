import { type ClientEvents, Events } from "discord.js";
import type Bot from "./Bot";
import BotListener from "./BotListener";

export type ListenerMessage = ClientEvents[Events.MessageCreate][0];

/**
 * Fires on messages whose content contains any of `substrings`.
 *
 * The substring test is not done here: `EventManager` indexes every
 * substring listener in one Aho-Corasick automaton and scans each message
 * once. `matches` only runs for listeners whose substring was found, so
 * override it (calling `super.matches`) for extra conditions.
 */
export default abstract class SubstringListener extends BotListener<Events.MessageCreate> {
	override readonly event = Events.MessageCreate;
	/** Any one of these appearing in the message content triggers the listener. */
	abstract readonly substrings: readonly string[];
	readonly caseSensitive: boolean = false;

	/** Ignores bot authors (including this bot) by default to avoid reply loops. */
	override matches(_bot: Bot, message: ListenerMessage): boolean {
		return !message.author.bot;
	}
}
