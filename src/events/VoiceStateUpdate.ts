import {
	type ClientEvents,
	Events,
	type VoiceBasedChannel,
	type VoiceState,
} from "discord.js";
import type { KazagumoPlayer } from "kazagumo";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";

export default class VoiceStateUpdate implements BotEvent {
	once = false;
	event: keyof ClientEvents = Events.VoiceStateUpdate;

	async execute(
		bot: Bot,
		oldState: VoiceState,
		newState: VoiceState,
	): Promise<void> {
		const player = bot.music.getPlayer(newState.guild.id);
		if (!player) {
			return;
		}

		if (newState.id === bot.user?.id) {
			await this.handleBotVoiceStateUpdate(player, newState);
			return;
		}

		if (
			oldState.channelId !== player.voiceId ||
			oldState.channelId === newState.channelId ||
			!oldState.channel
		) {
			return;
		}

		if (this.hasNonBotMembers(oldState.channel)) {
			return;
		}

		await player.destroy();
	}

	private async handleBotVoiceStateUpdate(
		player: KazagumoPlayer,
		newState: VoiceState,
	): Promise<void> {
		// Leave when disconnected or moved into a channel with no listeners.
		if (
			!newState.channelId ||
			(newState.channel && !this.hasNonBotMembers(newState.channel))
		) {
			await player.destroy();
		}
	}

	private hasNonBotMembers(channel: VoiceBasedChannel): boolean {
		return channel.members.some((member) => !member.user.bot);
	}
}
