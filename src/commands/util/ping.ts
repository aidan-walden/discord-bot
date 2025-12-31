import {
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";
import type Command from "../../models/Command";

export default class Ping implements Command {
	data: SlashCommandBuilder = new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Replies with pong");
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        await interaction.reply("Pong");
	}
}
