import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Pause implements Command {
	data = new SlashCommandBuilder()
		.setName("pause")
		.setDescription("Pauses the current track");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}

		const { player } = context;
		player.pause(true);
		await interaction.reply({ content: "Paused." });
	}
}
