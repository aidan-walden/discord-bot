import {
	bold,
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Volume implements Command {
	data = new SlashCommandBuilder()
		.setName("volume")
		.setDescription("Sets playback volume")
		.addIntegerOption((option) =>
			option
				.setName("volume")
				.setDescription("The new volume")
				.setMinValue(0)
				.setRequired(true),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context) {
			return;
		}
		const { player } = context;

		const newVol = interaction.options.getInteger("volume", true);

		await player.setVolume(newVol);
		await interaction.reply({ content: `Set volume to ${bold(`${newVol}`)}` });
	}
}
