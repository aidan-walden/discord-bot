import fs from "node:fs/promises";
import path from "node:path";
import type { ClientEvents } from "discord.js";
import AhoCorasick from "../helpers/ahoCorasick";
import { isRuntimeTypescriptModule } from "../helpers/runtimeModules";
import type Bot from "../models/Bot";
import BotListener from "../models/BotListener";
import SubstringListener, {
	type ListenerMessage,
} from "../models/SubstringListener";

type EventKey = keyof ClientEvents;
type AnyListener = BotListener<EventKey>;
type AnyArgs = ClientEvents[EventKey];
type RawHandler = (...args: unknown[]) => void;

/**
 * Every substring listener's patterns in one pair of automata (case-sensitive
 * and case-insensitive), so each message is scanned once no matter how many
 * substring listeners exist. Rebuilt lazily after the listener set changes.
 */
class SubstringIndex {
	private readonly listeners = new Set<SubstringListener>();
	private automata: {
		sensitive: AhoCorasick<SubstringListener>;
		insensitive: AhoCorasick<SubstringListener>;
	} | null = null;

	get size(): number {
		return this.listeners.size;
	}

	add(listener: SubstringListener): void {
		this.listeners.add(listener);
		this.automata = null;
	}

	delete(listener: SubstringListener): void {
		this.listeners.delete(listener);
		this.automata = null;
	}

	search(content: string): Set<SubstringListener> {
		if (this.listeners.size === 0 || content.length === 0) {
			return new Set();
		}
		this.automata ??= this.build();
		const hits = this.automata.sensitive.search(content);
		if (this.automata.insensitive.patternCount > 0) {
			for (const listener of this.automata.insensitive.search(
				content.toLowerCase(),
			)) {
				hits.add(listener);
			}
		}
		return hits;
	}

	private build() {
		const sensitive: [string, SubstringListener][] = [];
		const insensitive: [string, SubstringListener][] = [];
		for (const listener of this.listeners) {
			for (const substring of listener.substrings) {
				if (listener.caseSensitive) {
					sensitive.push([substring, listener]);
				} else {
					insensitive.push([substring.toLowerCase(), listener]);
				}
			}
		}
		return {
			sensitive: new AhoCorasick(sensitive),
			insensitive: new AhoCorasick(insensitive),
		};
	}
}

/** All listeners for one discord.js event key, behind one raw listener. */
class Route {
	readonly plain = new Set<AnyListener>();
	readonly substrings = new SubstringIndex();
	handler: RawHandler | null = null;

	get size(): number {
		return this.plain.size + this.substrings.size;
	}

	add(listener: AnyListener): void {
		if (listener instanceof SubstringListener) {
			this.substrings.add(listener);
		} else {
			this.plain.add(listener);
		}
	}

	delete(listener: AnyListener): void {
		if (listener instanceof SubstringListener) {
			this.substrings.delete(listener);
		} else {
			this.plain.delete(listener);
		}
	}

	candidates(args: AnyArgs): AnyListener[] {
		const candidates: AnyListener[] = [...this.plain];
		if (this.substrings.size > 0) {
			// Substring listeners are only ever registered on messageCreate.
			const message = args[0] as ListenerMessage;
			candidates.push(...this.substrings.search(message.content ?? ""));
		}
		return candidates;
	}
}

/**
 * Discovers `BotListener` modules and routes discord.js events to them. Each
 * event key gets at most one raw discord.js listener, attached only while that
 * key has listeners. For each event, every listener whose `matches` returns
 * true runs concurrently; failures are logged per listener.
 */
export default class EventManager {
	private readonly routes = new Map<EventKey, Route>();
	private readonly names = new Set<string>();
	private attached = false;

	constructor(private readonly bot: Bot) {}

	/**
	 * Import every listener module in `rootDir` (default export: a no-argument
	 * `BotListener` subclass). A missing directory means no listeners.
	 */
	async load(rootDir: string): Promise<void> {
		let files: string[];
		try {
			files = (await fs.readdir(rootDir)).filter(isRuntimeTypescriptModule);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw error;
		}
		for (const file of files.sort()) {
			const ListenerClass = (await import(path.join(rootDir, file)))
				.default as new () => unknown;
			const listener = new ListenerClass();
			if (!(listener instanceof BotListener)) {
				throw new Error(
					`Listener module ${file} must default-export a BotListener subclass`,
				);
			}
			if (listener.isEnabled(this.bot)) {
				this.register(listener);
			}
		}
	}

	register(listener: AnyListener): void {
		if (this.names.has(listener.name)) {
			throw new Error(`Duplicate listener name "${listener.name}"`);
		}
		if (listener instanceof SubstringListener) {
			if (
				listener.substrings.length === 0 ||
				listener.substrings.some((substring) => substring.length === 0)
			) {
				throw new Error(
					`Substring listener "${listener.name}" needs at least one non-empty substring`,
				);
			}
		}
		this.names.add(listener.name);
		let route = this.routes.get(listener.event);
		if (!route) {
			route = new Route();
			this.routes.set(listener.event, route);
		}
		route.add(listener);
		if (this.attached) {
			this.attachRoute(listener.event, route);
		}
	}

	/** Start receiving events. Listeners registered later attach immediately. */
	attach(): void {
		this.attached = true;
		for (const [event, route] of this.routes) {
			this.attachRoute(event, route);
		}
	}

	dispose(): void {
		this.attached = false;
		for (const [event, route] of this.routes) {
			this.detachRoute(event, route);
		}
	}

	/** Number of raw discord.js listeners currently attached. */
	get attachedEventCount(): number {
		let count = 0;
		for (const route of this.routes.values()) {
			if (route.handler) {
				count++;
			}
		}
		return count;
	}

	private attachRoute(event: EventKey, route: Route): void {
		if (route.handler || route.size === 0) {
			return;
		}
		const handler: RawHandler = (...args) => {
			void this.dispatch(event, route, args as AnyArgs);
		};
		route.handler = handler;
		this.bot.on(event, handler);
	}

	private detachRoute(event: EventKey, route: Route): void {
		if (!route.handler) {
			return;
		}
		this.bot.off(event, route.handler);
		route.handler = null;
	}

	private unregister(event: EventKey, route: Route, listener: AnyListener) {
		route.delete(listener);
		this.names.delete(listener.name);
		if (route.size === 0) {
			this.detachRoute(event, route);
		}
	}

	private async dispatch(
		event: EventKey,
		route: Route,
		args: AnyArgs,
	): Promise<void> {
		const matched: AnyListener[] = [];
		for (const listener of route.candidates(args)) {
			try {
				if (listener.matches(this.bot, ...args)) {
					matched.push(listener);
				}
			} catch (error) {
				console.error(`Listener ${listener.name} matches() failed`, error);
			}
		}
		// Unregister synchronously, before any await, so a concurrent event
		// cannot match a `once` listener a second time.
		for (const listener of matched) {
			if (listener.once) {
				this.unregister(event, route, listener);
			}
		}
		await Promise.all(
			matched.map((listener) =>
				// Wrapped so a synchronous throw is caught like a rejection.
				Promise.resolve()
					.then(() => listener.handle(this.bot, ...args))
					.catch((error) =>
						console.error(`Listener ${listener.name} failed`, error),
					),
			),
		);
	}
}
