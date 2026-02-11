import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Pitch implements Command {
	data = new SlashCommandBuilder()
		.setName("pitch")
		.setDescription("Sets playback pitch")
		.addIntegerOption((option) =>
			option
				.setName("pitch")
				.setDescription("The new pitch percentage")
				.setMinValue(0)
				.setRequired(true),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}
		const { player } = context;

		const newPitch = interaction.options.getInteger("pitch");
		if (newPitch === null) {
			await interaction.reply({
				content: "You must specify a new pitch.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const timescale = player.filters.timescale ?? {};
		await player.shoukaku.setTimescale({ ...timescale, pitch: newPitch / 100 });
		await interaction.reply({ content: `Set pitch to **${newPitch}%**` });
	}
}
