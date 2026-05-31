import { Events, type VoiceBasedChannel, type VoiceState } from "discord.js";
import type { KazagumoPlayer } from "kazagumo";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";

export default class VoiceStateUpdate implements BotEvent {
	once = false;
	event: (typeof Events)[keyof typeof Events] = Events.VoiceStateUpdate;

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

		await this.destroyPlayer(player);
	}

	private async handleBotVoiceStateUpdate(
		player: KazagumoPlayer,
		newState: VoiceState,
	): Promise<void> {
		if (!newState.channelId) {
			await this.destroyPlayer(player);
			return;
		}

		if (!newState.channel || this.hasNonBotMembers(newState.channel)) {
			return;
		}

		await this.destroyPlayer(player);
	}

	private hasNonBotMembers(channel: VoiceBasedChannel): boolean {
		return [...channel.members.values()].some((member) => !member.user.bot);
	}

	private async destroyPlayer(player: KazagumoPlayer): Promise<void> {
		await player.destroy();
	}
}
