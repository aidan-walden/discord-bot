/**
 * Interface for all event handlers to implement.
 * This makes iterating over events and registering them easier.
 */

import type {
	Events,
} from "discord.js";
import type Bot from "./Bot";

export default interface BotEvent {
	once: boolean;
    event: typeof Events[keyof typeof Events];
    execute(bot: Bot, ...args: unknown[]): Promise<void>;
}
