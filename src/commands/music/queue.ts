import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

export default class Queue implements Command {
	data = new SlashCommandBuilder()
		.setName("queue")
		.setDescription("Shows the current queue");
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}
		const { player } = context;

		const queue = Array.from(player.queue.entries());

		// Limit the queue to 2000 characters to avoid Discord message length limit
		const queueString = queue
			.map(
				([index, track]) =>
					`**${index + 1}**. ${track.title} by ${track.author}`,
			)
			.join("\n")
			.slice(0, 2000);

		await interaction.reply({
			content: `Current queue:\n${queueString.length > 0 ? queueString : "No songs in queue"}`,
			ephemeral: true,
		});
	}
}
