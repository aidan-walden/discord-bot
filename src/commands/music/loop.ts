import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Loop implements Command {
	data = new SlashCommandBuilder()
		.setName("loop")
		.setDescription("Toggles looping the current song");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}

		const { player } = context;
		const isLoopingTrack = player.loop === "track";
		player.setLoop(isLoopingTrack ? "none" : "track");

		if (!isLoopingTrack) {
			await interaction.reply({
				content: `Now looping: **${player.queue.current?.title ?? "current track"}**`,
			});
			return;
		}

		await interaction.reply({
			content: "No longer looping. Queue will advance after the track ends.",
		});
	}
}
