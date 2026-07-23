import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Stop implements Command {
	data = new SlashCommandBuilder()
		.setName("stop")
		.setDescription("Stops playback and leaves the voice channel");
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}

		await context.player.destroy();
		await interaction.reply({ content: "Player stopped" });
	}
}
