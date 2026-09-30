import type {
	ChatInputCommandInteraction,
	ClientEvents,
	Interaction,
} from "discord.js";
import { Events, MessageFlags } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";

const COMMAND_FAILED_MESSAGE =
	"Something went wrong while running that command.";

/** Tells the user a command failed, whatever state its reply was left in. */
async function replyCommandFailed(
	interaction: ChatInputCommandInteraction,
): Promise<void> {
	if (interaction.replied) {
		await interaction.followUp({
			content: COMMAND_FAILED_MESSAGE,
			flags: MessageFlags.Ephemeral,
		});
	} else if (interaction.deferred) {
		await interaction.editReply(COMMAND_FAILED_MESSAGE);
	} else {
		await interaction.reply({
			content: COMMAND_FAILED_MESSAGE,
			flags: MessageFlags.Ephemeral,
		});
	}
}

export default class InteractionCreate implements BotEvent {
	once: boolean = false;
	event: keyof ClientEvents = Events.InteractionCreate;
	async execute(bot: Bot, interaction: Interaction): Promise<void> {
		if (interaction.isAutocomplete()) {
			const command = bot.commands.get(interaction.commandName);
			if (!command?.autocomplete) {
				return;
			}

			await command.autocomplete(interaction);
			return;
		}

		if (!interaction.isChatInputCommand()) {
			return;
		}

		const command = bot.commands.get(interaction.commandName);
		if (!command) {
			return;
		}

		bot.metrics.recordCommand(interaction.commandName);
		try {
			await command.execute(interaction);
		} catch (error) {
			// Shared boundary: commands only catch errors they can explain better.
			console.error(`/${interaction.commandName} failed`, error);
			await replyCommandFailed(interaction).catch((replyError) =>
				console.error(
					`Failed to report /${interaction.commandName} failure`,
					replyError,
				),
			);
		}
	}
}
