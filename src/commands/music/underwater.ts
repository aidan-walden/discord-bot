import {
	type ChatInputCommandInteraction,
	SlashCommandBuilder,
} from "discord.js";
import type { Band } from "shoukaku";
import { getMusicCommandContext } from "../../helpers/musicCommandContext";
import type Command from "../../models/Command";

function generateBands(startingBand: number, zeroed = false): Band[] {
	const bands: Band[] = [];
	if (zeroed) {
		for (let i = startingBand; i < 15; i++) {
			bands.push({ band: i, gain: 0 });
		}
		return bands;
	}

	const iterValue = 0.25 / (15 - startingBand);
	let iter = 0;
	for (let i = startingBand; i < 15; i++) {
		iter -= iterValue;
		bands.push({ band: i, gain: iter });
	}
	return bands;
}

export default class Underwater implements Command {
	data = new SlashCommandBuilder()
		.setName("underwater")
		.setDescription('Toggles the "underwater" equalizer effect');

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const context = await getMusicCommandContext(interaction, {
			requireVoiceChannel: true,
			requirePlayer: true,
		});
		if (!context?.player) {
			return;
		}
		const { player } = context;

		const isEnabled = Boolean(
			player.filters.equalizer?.some((band) => band.band >= 5 && band.gain < 0),
		);
		await player.shoukaku.setEqualizer(generateBands(5, isEnabled));
		await interaction.reply({
			content: `Toggled underwater to **${!isEnabled}**`,
		});
	}
}
