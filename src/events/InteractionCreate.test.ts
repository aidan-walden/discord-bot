import { describe, expect, mock, test } from "bun:test";
import type { Interaction } from "discord.js";
import type Bot from "../models/Bot";
import type Command from "../models/Command";
import InteractionCreate from "./InteractionCreate";

function createBot(command?: Partial<Command>): Bot {
	const commands = new Map<string, Partial<Command>>();
	if (command) {
		commands.set("cmd", command);
	}
	return {
		commands,
		metrics: { recordCommand: mock(() => undefined) },
	} as unknown as Bot;
}

function createInteraction(options: {
	autocomplete?: boolean;
	chatInput?: boolean;
	commandName?: string;
}): Interaction {
	return {
		commandName: options.commandName ?? "cmd",
		isAutocomplete: () => options.autocomplete ?? false,
		isChatInputCommand: () => options.chatInput ?? false,
	} as unknown as Interaction;
}

describe("InteractionCreate", () => {
	test("dispatches autocomplete to the command's autocomplete handler", async () => {
		const autocomplete = mock(async () => undefined);
		const bot = createBot({ autocomplete });
		const interaction = createInteraction({ autocomplete: true });

		await new InteractionCreate().execute(bot, interaction);

		expect(autocomplete).toHaveBeenCalledWith(interaction);
	});

	test("ignores autocomplete when the command has no autocomplete handler", async () => {
		const execute = mock(async () => undefined);
		const bot = createBot({ execute });
		const interaction = createInteraction({ autocomplete: true });

		await new InteractionCreate().execute(bot, interaction);

		expect(execute).not.toHaveBeenCalled();
	});

	test("ignores autocomplete for an unknown command", async () => {
		const bot = createBot();
		const interaction = createInteraction({
			autocomplete: true,
			commandName: "missing",
		});

		expect(
			await new InteractionCreate().execute(bot, interaction),
		).toBeUndefined();
	});

	test("ignores interactions that are neither autocomplete nor chat input", async () => {
		const execute = mock(async () => undefined);
		const bot = createBot({ execute });
		const interaction = createInteraction({});

		await new InteractionCreate().execute(bot, interaction);

		expect(execute).not.toHaveBeenCalled();
	});

	test("ignores chat input for an unknown command", async () => {
		const bot = createBot();
		const interaction = createInteraction({
			chatInput: true,
			commandName: "missing",
		});

		expect(
			await new InteractionCreate().execute(bot, interaction),
		).toBeUndefined();
	});

	test("dispatches chat input to the command's execute handler", async () => {
		const execute = mock(async () => undefined);
		const bot = createBot({ execute });
		const interaction = createInteraction({ chatInput: true });

		await new InteractionCreate().execute(bot, interaction);

		expect(execute).toHaveBeenCalledWith(interaction);
		expect(bot.metrics.recordCommand).toHaveBeenCalledWith("cmd");
	});

	test("records a recognized command before a failing handler runs", async () => {
		const execute = mock(async () => {
			throw new Error("command failed");
		});
		const bot = createBot({ execute });
		const interaction = createInteraction({ chatInput: true });

		expect(new InteractionCreate().execute(bot, interaction)).rejects.toThrow(
			"command failed",
		);
		expect(bot.metrics.recordCommand).toHaveBeenCalledWith("cmd");
	});
});
