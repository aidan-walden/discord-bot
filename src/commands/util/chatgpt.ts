import {
	type AnyThreadChannel,
	type ChatInputCommandInteraction,
	InteractionContextType,
	MessageFlags,
	SlashCommandBuilder,
	TextChannel,
	ThreadAutoArchiveDuration,
} from "discord.js";
import { sendLongMessage } from "../../helpers/sendLongMessage";
import type Command from "../../models/Command";

function getThreadDisplayName(username: string): string {
	return `chatgpt-${username}`.slice(0, 100);
}

async function fetchManagedThread(
	interaction: ChatInputCommandInteraction,
	threadId: string,
): Promise<AnyThreadChannel | null> {
	const fetchedChannel = await interaction.client.channels
		.fetch(threadId)
		.catch(() => null);
	if (!fetchedChannel?.isThread()) {
		return null;
	}

	if (fetchedChannel.archived || fetchedChannel.locked) {
		return null;
	}

	return fetchedChannel;
}

export default class ChatGpt implements Command {
	data = new SlashCommandBuilder()
		.setName("chatgpt")
		.setDescription("Talk to ChatGPT in a managed thread")
		.setContexts([InteractionContextType.Guild])
		.addSubcommand((subcommand) =>
			subcommand
				.setName("ask")
				.setDescription("Start or continue a ChatGPT session")
				.addStringOption((option) =>
					option
						.setName("prompt")
						.setDescription("What you want to ask ChatGPT")
						.setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand
				.setName("end")
				.setDescription("End your ChatGPT session"),
		);

	async execute(interaction: ChatInputCommandInteraction): Promise<void> {
		const subcommand = interaction.options.getSubcommand();

		if (subcommand === "ask") {
			await this.handleAsk(interaction);
			return;
		}

		await this.handleEnd(interaction);
	}

	private async handleAsk(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (
			await interaction.client.bot.permissions.isGptUserBanned(
				interaction.user.id,
			)
		) {
			await interaction.editReply("You're banned from using ChatGPT.");
			return;
		}

		if (!interaction.channel) {
			await interaction.editReply(
				"This command can only be used in a text channel.",
			);
			return;
		}

		const prompt = interaction.options.getString("prompt", true).trim();
		if (prompt.length === 0) {
			await interaction.editReply("Please provide a prompt.");
			return;
		}

		if (!interaction.client.bot.chatSessions.isAvailable()) {
			await interaction.editReply(
				interaction.client.bot.chatSessions.getUnavailableReason(),
			);
			return;
		}

		const activeChannel = interaction.channel;
		let session = activeChannel.isThread()
			? interaction.client.bot.chatSessions.getByThreadId(activeChannel.id)
			: interaction.client.bot.chatSessions.getByRootChannel(
					interaction.user.id,
					activeChannel.id,
				);

		let thread: AnyThreadChannel | null = null;

		if (activeChannel.isThread()) {
			if (session && session.userId !== interaction.user.id) {
				await interaction.editReply(
					"That ChatGPT session belongs to another user.",
				);
				return;
			}

			thread = activeChannel;
			if (!session) {
				session = interaction.client.bot.chatSessions.createSession(
					interaction.user.id,
					activeChannel.parentId ?? activeChannel.id,
					activeChannel.id,
				);
			}
		} else if (activeChannel instanceof TextChannel) {
			if (session) {
				thread = await fetchManagedThread(interaction, session.threadChannelId);
				if (!thread) {
					interaction.client.bot.chatSessions.closeSession(session);
					session = undefined;
				}
			}

			if (!thread) {
				const seedMessage = await activeChannel.send({
					content: `Starting a ChatGPT session for ${interaction.user}.`,
				});
				thread = await seedMessage.startThread({
					name: getThreadDisplayName(interaction.user.username),
					autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
					reason: `ChatGPT session for ${interaction.user.tag}`,
				});
				session = interaction.client.bot.chatSessions.createSession(
					interaction.user.id,
					activeChannel.id,
					thread.id,
				);
			}
		} else {
			await interaction.editReply(
				"ChatGPT sessions can only be started from a server.",
			);
			return;
		}

		if (!session || !thread) {
			await interaction.editReply(
				"Failed to create or locate ChatGPT thread.",
			);
			return;
		}

		if (session.isBusy) {
			await interaction.editReply(
				`OpenAI is still processing your previous message in ${thread}.`,
			);
			return;
		}

		await interaction.editReply(`ChatGPT is responding in ${thread}.`);

		try {
			await thread.sendTyping();
			const response = await interaction.client.bot.chatSessions.prompt(
				session,
				prompt,
			);
			await sendLongMessage(thread, response);
		} catch (error) {
			console.error("ChatGPT ask command failed:", error);
			await thread.send(
				`ChatGPT failed to respond. Please contact @<${interaction.client.bot.config.BOT_OWNER_ID}>`,
			);
		}
	}

	private async handleEnd(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.channel) {
			await interaction.editReply(
				"This command can only be used in a text channel.",
			);
			return;
		}

		const session = interaction.channel.isThread()
			? interaction.client.bot.chatSessions.getByThreadId(
					interaction.channel.id,
				)
			: interaction.client.bot.chatSessions.getByRootChannel(
					interaction.user.id,
					interaction.channel.id,
				);

		if (!session) {
			await interaction.editReply(
				"You do not have an active ChatGPT session in this channel.",
			);
			return;
		}

		if (session.userId !== interaction.user.id) {
			await interaction.editReply(
				"That ChatGPT session belongs to another user.",
			);
			return;
		}

		interaction.client.bot.chatSessions.closeSession(session);
		const thread = await fetchManagedThread(
			interaction,
			session.threadChannelId,
		);
		if (thread) {
			await thread.send(`ChatGPT session ended by ${interaction.user}.`);
		}

		await interaction.editReply("Ended your active ChatGPT session.");
	}
}
