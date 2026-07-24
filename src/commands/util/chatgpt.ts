import {
	type AnyThreadChannel,
	type ChatInputCommandInteraction,
	channelMention,
	InteractionContextType,
	MessageFlags,
	SlashCommandBuilder,
	TextChannel,
	ThreadAutoArchiveDuration,
	userMention,
} from "discord.js";
import { sendLongMessage } from "../../helpers/sendLongMessage";
import type Command from "../../models/Command";
import {
	LlmUserRateLimitError,
	llmRateLimitNotice,
} from "../../services/LlmProvider";

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
		.setDescription("Talk to the AI assistant in a managed thread")
		.setContexts([InteractionContextType.Guild])
		.addSubcommand((subcommand) =>
			subcommand
				.setName("ask")
				.setDescription("Start or continue an AI assistant session")
				.addStringOption((option) =>
					option
						.setName("prompt")
						.setDescription("What you want to ask the AI assistant")
						.setRequired(true),
				),
		)
		.addSubcommand((subcommand) =>
			subcommand.setName("end").setDescription("End your AI assistant session"),
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
			await interaction.editReply("You're banned from using the AI assistant.");
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
					"That AI assistant session belongs to another user.",
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
					content: `Starting an AI assistant session for ${userMention(interaction.user.id)}.`,
				});
				thread = await seedMessage.startThread({
					name: getThreadDisplayName(interaction.user.username),
					autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
					reason: `AI assistant session for ${interaction.user.tag}`,
				});
				session = interaction.client.bot.chatSessions.createSession(
					interaction.user.id,
					activeChannel.id,
					thread.id,
				);
			}
		} else {
			await interaction.editReply(
				"AI assistant sessions can only be started from a server.",
			);
			return;
		}

		if (!session || !thread) {
			await interaction.editReply(
				"Failed to create or locate the AI assistant thread.",
			);
			return;
		}

		if (session.isBusy) {
			await interaction.editReply(
				`The AI assistant is still processing your previous message in ${channelMention(thread.id)}.`,
			);
			return;
		}

		await interaction.editReply(
			`The AI assistant is responding in ${channelMention(thread.id)}.`,
		);

		try {
			await thread.sendTyping();
			const response = await interaction.client.bot.chatSessions.prompt(
				session,
				prompt,
			);
			await sendLongMessage(thread, response, {}, false);
		} catch (error) {
			if (error instanceof LlmUserRateLimitError) {
				await interaction.followUp({
					content: llmRateLimitNotice(error),
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			console.error("AI assistant ask command failed:", error);
			await thread.send(
				`The AI assistant failed to respond. Please contact ${userMention(interaction.client.bot.config.get("BOT_OWNER_ID"))}`,
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
				"You do not have an active AI assistant session in this channel.",
			);
			return;
		}

		if (session.userId !== interaction.user.id) {
			await interaction.editReply(
				"That AI assistant session belongs to another user.",
			);
			return;
		}

		interaction.client.bot.chatSessions.closeSession(session);
		const thread = await fetchManagedThread(
			interaction,
			session.threadChannelId,
		);
		if (thread) {
			await thread.send(
				`AI assistant session ended by ${userMention(interaction.user.id)}.`,
			);
		}

		await interaction.editReply("Ended your active AI assistant session.");
	}
}
