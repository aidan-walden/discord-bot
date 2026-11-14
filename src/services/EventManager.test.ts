import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Events } from "discord.js";
import type Bot from "../models/Bot";
import BotListener from "../models/BotListener";
import SubstringListener, {
	type ListenerMessage,
} from "../models/SubstringListener";
import EventManager from "./EventManager";

function createBot(): Bot & EventEmitter {
	return new EventEmitter() as unknown as Bot & EventEmitter;
}

function createMessage(content: string, authorBot = false): ListenerMessage {
	return { content, author: { bot: authorBot } } as ListenerMessage;
}

class TestSubstring extends SubstringListener {
	readonly handled: string[] = [];
	override readonly caseSensitive: boolean;

	constructor(
		readonly name: string,
		readonly substrings: readonly string[],
		options: { caseSensitive?: boolean } = {},
	) {
		super();
		this.caseSensitive = options.caseSensitive ?? false;
	}

	async handle(_bot: Bot, message: ListenerMessage): Promise<void> {
		this.handled.push(message.content);
	}
}

/** Lets every handler the manager started settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("EventManager", () => {
	test("attaches one raw listener per event key, only while routes have listeners", () => {
		const bot = createBot();
		const manager = new EventManager(bot);
		manager.register(new TestSubstring("a", ["alpha"]));
		manager.register(new TestSubstring("b", ["beta"]));
		expect(bot.listenerCount(Events.MessageCreate)).toBe(0);

		manager.attach();
		expect(bot.listenerCount(Events.MessageCreate)).toBe(1);
		expect(manager.attachedEventCount).toBe(1);

		manager.dispose();
		expect(bot.listenerCount(Events.MessageCreate)).toBe(0);
	});

	test("routes each message only to listeners whose substring occurs", async () => {
		const bot = createBot();
		const manager = new EventManager(bot);
		const hello = new TestSubstring("hello", ["hello", "hi there"]);
		const bye = new TestSubstring("bye", ["goodbye"]);
		manager.register(hello);
		manager.register(bye);
		manager.attach();

		bot.emit(Events.MessageCreate, createMessage("well hi there friend"));
		bot.emit(Events.MessageCreate, createMessage("hello and goodbye"));
		bot.emit(Events.MessageCreate, createMessage("unrelated"));
		await flush();

		expect(hello.handled).toEqual([
			"well hi there friend",
			"hello and goodbye",
		]);
		expect(bye.handled).toEqual(["hello and goodbye"]);
	});

	test("matches case-insensitively unless the listener opts out", async () => {
		const bot = createBot();
		const manager = new EventManager(bot);
		const loose = new TestSubstring("loose", ["Hello"]);
		const strict = new TestSubstring("strict", ["Hello"], {
			caseSensitive: true,
		});
		manager.register(loose);
		manager.register(strict);
		manager.attach();

		bot.emit(Events.MessageCreate, createMessage("HELLO"));
		bot.emit(Events.MessageCreate, createMessage("Hello"));
		await flush();

		expect(loose.handled).toEqual(["HELLO", "Hello"]);
		expect(strict.handled).toEqual(["Hello"]);
	});

	test("ignores bot authors by default and honours overridden matches", async () => {
		class GuildOnly extends TestSubstring {
			override matches(bot: Bot, message: ListenerMessage): boolean {
				return super.matches(bot, message) && message.content.endsWith("!");
			}
		}
		const bot = createBot();
		const manager = new EventManager(bot);
		const base = new TestSubstring("base", ["ping"]);
		const extended = new GuildOnly("extended", ["ping"]);
		manager.register(base);
		manager.register(extended);
		manager.attach();

		bot.emit(Events.MessageCreate, createMessage("ping!", true));
		bot.emit(Events.MessageCreate, createMessage("ping"));
		bot.emit(Events.MessageCreate, createMessage("ping!"));
		await flush();

		expect(base.handled).toEqual(["ping", "ping!"]);
		expect(extended.handled).toEqual(["ping!"]);
	});

	test("runs plain listeners on the same event alongside substring listeners", async () => {
		const handled: string[] = [];
		class Everything extends BotListener<Events.MessageCreate> {
			readonly name = "everything";
			readonly event = Events.MessageCreate;
			async handle(_bot: Bot, message: ListenerMessage): Promise<void> {
				handled.push(message.content);
			}
		}
		const bot = createBot();
		const manager = new EventManager(bot);
		const substring = new TestSubstring("substring", ["needle"]);
		manager.register(new Everything());
		manager.register(substring);
		manager.attach();

		bot.emit(Events.MessageCreate, createMessage("hay"));
		bot.emit(Events.MessageCreate, createMessage("needle"));
		await flush();

		expect(handled).toEqual(["hay", "needle"]);
		expect(substring.handled).toEqual(["needle"]);
		expect(bot.listenerCount(Events.MessageCreate)).toBe(1);
	});

	test("isolates a failing listener from the others", async () => {
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});
		class Throws extends TestSubstring {
			override async handle(): Promise<void> {
				throw new Error("boom");
			}
		}
		class ThrowsInMatches extends TestSubstring {
			override matches(): boolean {
				throw new Error("bad match");
			}
		}
		const bot = createBot();
		const manager = new EventManager(bot);
		const healthy = new TestSubstring("healthy", ["x"]);
		manager.register(new Throws("throws", ["x"]));
		manager.register(new ThrowsInMatches("throws-in-matches", ["x"]));
		manager.register(healthy);
		manager.attach();

		bot.emit(Events.MessageCreate, createMessage("x"));
		await flush();

		expect(healthy.handled).toEqual(["x"]);
		expect(errorSpy).toHaveBeenCalledTimes(2);
		errorSpy.mockRestore();
	});

	test("removes a once listener after its first match and detaches when empty", async () => {
		class Once extends TestSubstring {
			override readonly once = true;
		}
		const bot = createBot();
		const manager = new EventManager(bot);
		const once = new Once("once", ["go"]);
		manager.register(once);
		manager.attach();

		bot.emit(Events.MessageCreate, createMessage("no"));
		bot.emit(Events.MessageCreate, createMessage("go"));
		bot.emit(Events.MessageCreate, createMessage("go again"));
		await flush();

		expect(once.handled).toEqual(["go"]);
		expect(bot.listenerCount(Events.MessageCreate)).toBe(0);

		// The name is free again, and a new listener re-attaches the route.
		const again = new TestSubstring("once", ["go"]);
		manager.register(again);
		expect(bot.listenerCount(Events.MessageCreate)).toBe(1);
		bot.emit(Events.MessageCreate, createMessage("go"));
		await flush();
		expect(again.handled).toEqual(["go"]);
	});

	test("rejects duplicate names and empty substrings", () => {
		const manager = new EventManager(createBot());
		manager.register(new TestSubstring("dup", ["a"]));

		expect(() => manager.register(new TestSubstring("dup", ["b"]))).toThrow(
			'Duplicate listener name "dup"',
		);
		expect(() => manager.register(new TestSubstring("none", []))).toThrow(
			"non-empty substring",
		);
		expect(() => manager.register(new TestSubstring("blank", [""]))).toThrow(
			"non-empty substring",
		);
	});

	describe("load", () => {
		let dir: string | null = null;

		afterEach(async () => {
			if (dir) {
				await rm(dir, { recursive: true, force: true });
				dir = null;
			}
		});

		const modelsDir = path.join(import.meta.dirname, "../models");

		function listenerModule(name: string, enabled = true): string {
			return `
import SubstringListener from ${JSON.stringify(path.join(modelsDir, "SubstringListener.ts"))};
export default class extends SubstringListener {
	name = ${JSON.stringify(name)};
	substrings = ["needle"];
	isEnabled() { return ${enabled}; }
	async handle() { globalThis.__loadedListenerCalls.push(${JSON.stringify(name)}); }
}
`;
		}

		test("loads enabled listener modules and skips tests and disabled ones", async () => {
			dir = await mkdtemp(path.join(tmpdir(), "listeners-"));
			await Bun.write(path.join(dir, "First.ts"), listenerModule("first"));
			await Bun.write(
				path.join(dir, "Disabled.ts"),
				listenerModule("disabled", false),
			);
			await Bun.write(
				path.join(dir, "First.test.ts"),
				"throw new Error('should not load');",
			);
			const calls: string[] = [];
			(globalThis as Record<string, unknown>).__loadedListenerCalls = calls;

			const bot = createBot();
			const manager = new EventManager(bot);
			await manager.load(dir);
			manager.attach();
			bot.emit(Events.MessageCreate, createMessage("a needle"));
			await flush();

			expect(calls).toEqual(["first"]);
		});

		test("rejects modules that do not export a BotListener", async () => {
			dir = await mkdtemp(path.join(tmpdir(), "listeners-"));
			await Bun.write(path.join(dir, "Bad.ts"), "export default class {}");

			await expect(new EventManager(createBot()).load(dir)).rejects.toThrow(
				"must default-export a BotListener subclass",
			);
		});

		test("treats a missing directory as no listeners", async () => {
			const manager = new EventManager(createBot());
			await manager.load(path.join(tmpdir(), "does-not-exist-listeners"));
			manager.attach();
			expect(manager.attachedEventCount).toBe(0);
		});
	});

	test("handle receives the bot", async () => {
		const handle = mock(async () => {});
		class Capture extends TestSubstring {
			override handle = handle;
		}
		const bot = createBot();
		const manager = new EventManager(bot);
		manager.register(new Capture("capture", ["z"]));
		manager.attach();
		const message = createMessage("z");

		bot.emit(Events.MessageCreate, message);
		await flush();

		expect(handle).toHaveBeenCalledWith(bot, message);
	});
});
