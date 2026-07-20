import { randomInt } from "node:crypto";
import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import type Command from "../../models/Command";

const videoExtensions = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const videosDirectory = path.resolve(
	import.meta.dirname,
	"../../../assets/videosfolder",
);

function pickRandom<T>(items: readonly T[]): T | undefined {
	if (items.length === 0) return undefined;
	return items[randomInt(items.length)];
}

async function listVideos(): Promise<string[]> {
	const directory = statSync(videosDirectory, { throwIfNoEntry: false });
	if (!directory?.isDirectory()) return [];

	const items = await readdir(videosDirectory, { withFileTypes: true });
	return items
		.filter(
			(item) =>
				item.isFile() &&
				videoExtensions.has(path.extname(item.name).toLowerCase()),
		)
		.map((item) => item.name);
}

export default class VideosFolder implements Command {
	data = new SlashCommandBuilder()
		.setName("videosfolder")
		.setDescription("Sends a random video");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const video = pickRandom(await listVideos());
		if (!video) {
			await interaction.reply({
				content: "No videos found.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.reply({ files: [path.join(videosDirectory, video)] });
	}
}
