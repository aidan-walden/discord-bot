import {
	GuildMember,
	MessageFlags,
	SlashCommandBuilder,
	type ChatInputCommandInteraction,
} from "discord.js";
import type Command from "../../models/Command";

export default class Queue implements Command {
	data = new SlashCommandBuilder()
		.setName("queue")
		.setDescription("Shows the current queue");
	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		if (!interaction.guildId) {
			await interaction.reply({ content: "This command can only be used in a guild", flags: MessageFlags.Ephemeral });
			return;
		}

		if (!(interaction.member instanceof GuildMember)) {
			await interaction.reply({ content: "This command can only be used by a member", flags: MessageFlags.Ephemeral });
			return;
		}


		const player = interaction.client.bot.music.getPlayer(interaction.guildId);
		if (!player) {
			await interaction.reply({ content: "There is nothing playing", flags: MessageFlags.Ephemeral });
			return;
		}

		const queue = Array.from(player.queue.entries());

        // Limit the queue to 2000 characters to avoid Discord message length limit
        const queueString = queue.map(([index, track]) => `**${index + 1}**. ${track.title} by ${track.author}`).join("\n").slice(0, 2000);

		await interaction.reply({ content: `Current queue:\n${queueString.length > 0 ? queueString : "No songs in queue"}`, flags: MessageFlags.Ephemeral });
	}
}
