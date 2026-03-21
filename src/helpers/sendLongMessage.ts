import type { MessageCreateOptions } from "discord.js";

const DISCORD_MESSAGE_LIMIT = 2000;

function chunkMessage(content: string): string[] {
	if (content.length <= DISCORD_MESSAGE_LIMIT) {
		return [content];
	}

	const chunks: string[] = [];
	let remaining = content;
	while (remaining.length > 0) {
		if (remaining.length <= DISCORD_MESSAGE_LIMIT) {
			chunks.push(remaining);
			break;
		}

		const nextChunk = remaining.slice(0, DISCORD_MESSAGE_LIMIT);
		const splitAt = nextChunk.lastIndexOf("\n");
		const chunkLength = splitAt > 0 ? splitAt : DISCORD_MESSAGE_LIMIT;
		chunks.push(remaining.slice(0, chunkLength));
		remaining = remaining.slice(chunkLength).trimStart();
	}

	return chunks;
}

export async function sendLongMessage(
	channel: {
		send(options: MessageCreateOptions): Promise<unknown>;
	},
	content: string,
	baseOptions: Omit<MessageCreateOptions, "content"> = {},
): Promise<void> {
	for (const chunk of chunkMessage(content)) {
		await channel.send({
			...baseOptions,
			content: chunk,
		});
	}
}
