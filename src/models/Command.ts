/**
 * Interface for all slash commands to implement.
 * This makes iterating over commands and registering them easier.
 */

import type {
	ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";

export default interface Command {
	data: SlashCommandBuilder;
	execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
