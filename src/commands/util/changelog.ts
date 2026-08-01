import path from "node:path";
import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import { prepareMessageChunks } from "../../helpers/sendLongMessage";
import type Command from "../../models/Command";

const CHANGELOG_PATH = path.resolve(
	import.meta.dirname,
	"../../../assets/changelog.md",
);

export default class Changelog implements Command {
	data: SlashCommandBuilder = new SlashCommandBuilder()
		.setName("changelog")
		.setDescription("Show the bot changelog");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const text = await Bun.file(CHANGELOG_PATH)
			.text()
			.catch(() => null);
		if (text === null) {
			await interaction.reply({
				content: "changelog.md not found.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (text.length <= 2000) {
			await interaction.reply({ content: text });
			return;
		}

		const chunks = prepareMessageChunks(text, false);
		const [first, ...rest] = chunks;
		await interaction.reply({
			content: first,
			allowedMentions: { parse: [] },
		});
		for (const chunk of rest) {
			await interaction.followUp({
				content: chunk,
				allowedMentions: { parse: [] },
			});
		}
	}
}
