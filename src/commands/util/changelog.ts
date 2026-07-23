import path from "node:path";
import {
	AttachmentBuilder,
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
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

		// ponytail: attach when over 2000; chunked followUps if in-channel multi-post preferred later
		if (text.length <= 2000) {
			await interaction.reply({ content: text });
			return;
		}

		await interaction.reply({
			files: [
				new AttachmentBuilder(Buffer.from(text), { name: "changelog.md" }),
			],
		});
	}
}
