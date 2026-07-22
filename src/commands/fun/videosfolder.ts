import { randomInt } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
	type ChatInputCommandInteraction,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import type Command from "../../models/Command";

const videoExtensions = new Set([".mp4", ".webm", ".mov", ".mkv"]);
const MAX_VIDEO_BYTES = 10 * 1024 * 1024;
const videosDirectory = path.resolve(
	import.meta.dirname,
	"../../../assets/videosfolder",
);

function pickRandom<T>(items: readonly T[]): T | undefined {
	if (items.length === 0) return undefined;
	return items[randomInt(items.length)];
}

function loadVideos(): string[] {
	const directory = statSync(videosDirectory, { throwIfNoEntry: false });
	if (!directory?.isDirectory()) {
		console.warn(
			`videosfolder: directory missing or not a dir: ${videosDirectory}`,
		);
		return [];
	}

	const eligible: string[] = [];
	for (const item of readdirSync(videosDirectory, { withFileTypes: true })) {
		if (!item.isFile()) continue;
		if (!videoExtensions.has(path.extname(item.name).toLowerCase())) continue;

		const full = path.join(videosDirectory, item.name);
		const { size } = statSync(full);
		if (size > MAX_VIDEO_BYTES) {
			console.warn(
				`videosfolder: excluding ${item.name} (${size} bytes > ${MAX_VIDEO_BYTES})`,
			);
			continue;
		}
		eligible.push(item.name);
	}

	if (eligible.length === 0) {
		console.warn("videosfolder: no uploadable videos after size filter");
	}
	return eligible;
}

const videos = loadVideos();

export default class VideosFolder implements Command {
	data = new SlashCommandBuilder()
		.setName("videosfolder")
		.setDescription("Sends a random video");

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const video = pickRandom(videos);
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
