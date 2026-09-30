import {
	type ClientEvents,
	Events,
	type VoiceBasedChannel,
	type VoiceState,
} from "discord.js";
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
		const guildId = newState.guild.id;
		if (bot.voiceSessions.getOwner(guildId) === "none") {
			return;
		}

		if (newState.id === bot.user?.id) {
			await this.handleBotVoiceStateUpdate(bot, guildId, newState);
			return;
		}

		if (
			oldState.channelId !== bot.voiceSessions.getVoiceChannelId(guildId) ||
			oldState.channelId === newState.channelId ||
			!oldState.channel
		) {
			return;
		}

		if (this.hasNonBotMembers(oldState.channel)) {
			return;
		}

		await bot.voiceSessions.leave(guildId);
	}

	private async handleBotVoiceStateUpdate(
		bot: Bot,
		guildId: string,
		newState: VoiceState,
	): Promise<void> {
		// Leave when disconnected or moved into a channel with no listeners.
		if (
			!newState.channelId ||
			(newState.channel && !this.hasNonBotMembers(newState.channel))
		) {
			await bot.voiceSessions.leave(guildId);
		}
	}

	private hasNonBotMembers(channel: VoiceBasedChannel): boolean {
		return channel.members.some((member) => !member.user.bot);
	}
}
