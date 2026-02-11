import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Speed implements Command {
	data = new SlashCommandBuilder()
		.setName("speed")
		.setDescription("Sets playback speed")
		.addIntegerOption((option) =>
			option
				.setName("speed")
				.setDescription("The new speed percentage")
				.setMinValue(1)
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

		const newSpeed = interaction.options.getInteger("speed");
		if (newSpeed === null) {
			await interaction.reply({
				content: "You must specify a new speed.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const timescale = player.filters.timescale ?? {};
		await player.shoukaku.setTimescale({ ...timescale, speed: newSpeed / 100 });
		await interaction.reply({ content: `Set speed to **${newSpeed}%**` });
	}
}
