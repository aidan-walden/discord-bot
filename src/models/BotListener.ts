import type { ClientEvents } from "discord.js";
import type Bot from "./Bot";

/**
 * A listener routed by `EventManager`. The manager attaches one discord.js
 * listener per event key and, for each event, runs `handle` on every listener
 * whose `matches` returns true. All matching listeners run concurrently.
 *
 * Concrete listeners live in `src/listeners/` and are discovered at startup.
 * Keep `matches` synchronous and cheap; async checks belong in `handle`.
 */
export default abstract class BotListener<
	K extends keyof ClientEvents = keyof ClientEvents,
> {
	/** Unique across all listeners; used in logs. */
	abstract readonly name: string;
	abstract readonly event: K;
	/** When true, the listener is removed after its first match. */
	readonly once: boolean = false;

	/** Registration gate: returning false skips the listener entirely. */
	isEnabled(_bot: Bot): boolean {
		return true;
	}

	matches(_bot: Bot, ..._args: ClientEvents[K]): boolean {
		return true;
	}

	abstract handle(bot: Bot, ...args: ClientEvents[K]): Promise<void>;
}
