/**
 * Interface for all event handlers to implement.
 * This makes iterating over events and registering them easier.
 */

import type { ClientEvents } from "discord.js";
import type Bot from "./Bot";

export default interface BotEvent {
	once: boolean;
	event: keyof ClientEvents;
	execute(bot: Bot, ...args: unknown[]): Promise<void>;
}
