import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Rotation implements Command {
	data = new SlashCommandBuilder()
		.setName("rotation")
		.setDescription("Sets rotation speed")
		.addNumberOption((option) =>
			option
				.setName("speed")
				.setDescription("The new rotation speed in Hz")
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

		const newSpeed = interaction.options.getNumber("speed");
		if (newSpeed === null) {
			await interaction.reply({
				content: "You must specify a new speed.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await player.shoukaku.setRotation({ rotationHz: newSpeed });
		await interaction.reply({
			content: `Set rotation speed to **${newSpeed}Hz**`,
		});
	}
}
