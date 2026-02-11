import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Skip implements Command {
	data = new SlashCommandBuilder()
		.setName("skip")
		.setDescription("Skips the current song");
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}

		const { player } = context;
		player.skip();
		await interaction.reply({ content: "Skipped the current song" });
	}
}
