import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Clear implements Command {
	data = new SlashCommandBuilder()
		.setName("clear")
		.setDescription("Clears the queue");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}

		const { player } = context;
		player.queue.clear();
		await interaction.reply({ content: "Cleared the queue." });
	}
}
