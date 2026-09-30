import {
	type ChatInputCommandInteraction,
	GuildMember,
	MessageFlags,
} from "discord.js";
import type { KazagumoPlayer } from "kazagumo";

type MusicCommandContextOptions = {
	requireVoiceChannel?: boolean;
	requirePlayer?: boolean;
};

/** Narrows `voiceChannelId` and `player` to non-null when the caller required them. */
type MusicCommandContext<O extends MusicCommandContextOptions> = {
	guildId: string;
	member: GuildMember;
	voiceChannelId: O["requireVoiceChannel"] extends true
		? string
		: string | null;
	player: O["requirePlayer"] extends true ? KazagumoPlayer : undefined;
};

export async function getMusicCommandContext<
	const O extends MusicCommandContextOptions = Record<never, never>,
>(
	interaction: ChatInputCommandInteraction,
	options: O = {} as O,
): Promise<MusicCommandContext<O> | null> {
	const { requireVoiceChannel = false, requirePlayer = false } = options;

	if (!interaction.guildId) {
		await interaction.reply({
			content: "This command can only be used in a guild",
			flags: MessageFlags.Ephemeral,
		});
		return null;
	}

	if (!(interaction.member instanceof GuildMember)) {
		await interaction.reply({
			content: "This command can only be used by a member",
			flags: MessageFlags.Ephemeral,
		});
		return null;
	}

	const usageBlockReason =
		await interaction.client.bot.permissions.getMusicUsageBlockReason(
			interaction.user.id,
			interaction.guildId,
		);
	if (usageBlockReason) {
		await interaction.reply({
			content: usageBlockReason,
			flags: MessageFlags.Ephemeral,
		});
		return null;
	}

	const voiceChannelId = interaction.member.voice.channelId;
	if (requireVoiceChannel && !voiceChannelId) {
		await interaction.reply({
			content: "You must be in a voice channel to use this command",
			flags: MessageFlags.Ephemeral,
		});
		return null;
	}

	let player: KazagumoPlayer | undefined;
	if (requirePlayer) {
		player = interaction.client.bot.music.getPlayer(interaction.guildId);
		if (!player) {
			await interaction.reply({
				content: "There is nothing playing",
				flags: MessageFlags.Ephemeral,
			});
			return null;
		}
	}

	return {
		guildId: interaction.guildId,
		member: interaction.member,
		voiceChannelId,
		player,
	} as MusicCommandContext<O>;
}
