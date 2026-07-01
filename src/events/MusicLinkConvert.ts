import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ClientEvents,
	ComponentType,
	EmbedBuilder,
	Events,
	type Message,
} from "discord.js";
import { detectMusicLinks } from "../helpers/musicLinks";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";
import type { MusicItem, MusicPlatform } from "../services/musicTypes";

const DELETE_BUTTON_ID = "musiclink:delete";
const BUTTON_LIFETIME_MS = 60_000;

const PLATFORM_LABELS: Record<MusicPlatform, string> = {
	spotify: "Spotify",
	apple: "Apple Music",
};

const PLATFORM_COLORS: Record<MusicPlatform, number> = {
	spotify: 0x1db954,
	apple: 0xfa243c,
};

/**
 * Replies to Spotify/Apple Music links with the equivalent link on the other
 * platform, in an embed carrying a self-expiring 🗑️ delete button.
 */
export default class MusicLinkConvert implements BotEvent {
	once = false;
	event: keyof ClientEvents = Events.MessageCreate;

	async execute(bot: Bot, message: Message): Promise<void> {
		if (
			message.author.bot ||
			!message.inGuild() ||
			message.content.trim().length === 0 ||
			!bot.musicLinks.isAvailable()
		) {
			return;
		}

		const [link] = detectMusicLinks(message.content);
		if (!link) {
			return;
		}

		try {
			const conversion = await bot.musicLinks.convert(link);
			if (!conversion) {
				return;
			}

			const embed = this.buildEmbed(conversion.source, conversion.target);
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId(DELETE_BUTTON_ID)
					.setLabel("🗑️")
					.setStyle(ButtonStyle.Danger),
			);

			const reply = await message.reply({
				embeds: [embed],
				components: [row],
			});

			this.attachDeleteButton(reply);
		} catch (error) {
			console.error("Music link conversion failed:", error);
		}
	}

	private buildEmbed(source: MusicItem, target: MusicItem): EmbedBuilder {
		const embed = new EmbedBuilder()
			.setColor(PLATFORM_COLORS[target.platform])
			.setTitle(target.title)
			.setURL(target.url)
			.setDescription(`by ${target.artist}`)
			.addFields({
				name: `${PLATFORM_LABELS[target.platform]} link`,
				value: target.url,
			})
			.setFooter({
				text: `Converted from ${PLATFORM_LABELS[source.platform]}`,
			});

		if (target.artworkUrl) {
			embed.setThumbnail(target.artworkUrl);
		}

		return embed;
	}

	/**
	 * Lets anyone delete the reply via the 🗑️ button for one minute; after that
	 * the button is removed and the collector torn down.
	 */
	private attachDeleteButton(reply: Message): void {
		const collector = reply.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: BUTTON_LIFETIME_MS,
		});

		collector.on("collect", async (interaction) => {
			if (interaction.customId !== DELETE_BUTTON_ID) {
				return;
			}
			await interaction.deferUpdate().catch(() => {});
			await reply.delete().catch(() => {});
			collector.stop("deleted");
		});

		collector.on("end", async (_collected, reason) => {
			if (reason === "deleted") {
				return;
			}
			await reply.edit({ components: [] }).catch(() => {});
		});
	}
}
