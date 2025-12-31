import type { Interaction } from "discord.js";
import { Events } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";

export default class InteractionCreate implements BotEvent {
	once: boolean = false;
	event: typeof Events[keyof typeof Events] = Events.InteractionCreate;
	async execute(bot: Bot, interaction: Interaction): Promise<void> {
		if (!interaction.isChatInputCommand()) return;
		const command = bot.commands.get(interaction.commandName);
		if (!command) return;
		await command.execute(interaction);
	}
}