import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class ResetFilters implements Command {
	data = new SlashCommandBuilder()
		.setName("resetfilters")
		.setDescription("Resets all player filters");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}

		const { player } = context;
		await player.shoukaku.clearFilters();
		await player.shoukaku.setTimescale({ pitch: 1, speed: 1 });
		await interaction.reply({ content: "Filters reset." });
	}
}
