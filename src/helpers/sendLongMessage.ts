import {
	codeBlock,
	escapeMarkdown,
	type MessageCreateOptions,
	type SendableChannels,
} from "discord.js";

const DISCORD_MESSAGE_LIMIT = 2000;
// ```\n + \n```
const CODE_BLOCK_BODY_LIMIT = DISCORD_MESSAGE_LIMIT - 8;

function stripOuterCodeBlock(content: string): string | null {
	const match = content.match(/^```[^\n]*\n([\s\S]*)\n```$/);
	return match ? (match[1] ?? "") : null;
}

function chunkMessage(
	content: string,
	limit = DISCORD_MESSAGE_LIMIT,
): string[] {
	if (content.length <= limit) {
		return [content];
	}

	const chunks: string[] = [];
	let remaining = content;
	while (remaining.length > 0) {
		if (remaining.length <= limit) {
			chunks.push(remaining);
			break;
		}

		const nextChunk = remaining.slice(0, limit);
		const splitAt = nextChunk.lastIndexOf("\n");
		const chunkLength = splitAt > 0 ? splitAt : limit;
		chunks.push(remaining.slice(0, chunkLength));
		remaining = remaining.slice(chunkLength).trimStart();
	}

	return chunks;
}

function prepareChunks(
	content: string,
	shouldEscapeMarkdown: boolean,
): string[] {
	const text = shouldEscapeMarkdown ? escapeMarkdown(content) : content;
	const body = stripOuterCodeBlock(text);
	if (body !== null) {
		return chunkMessage(body, CODE_BLOCK_BODY_LIMIT).map((chunk) =>
			codeBlock(chunk),
		);
	}

	return chunkMessage(text);
}

export async function sendLongMessage(
	channel: SendableChannels,
	content: string,
	baseOptions: Omit<MessageCreateOptions, "content"> = {},
	shouldEscapeMarkdown = true,
): Promise<void> {
	for (const chunk of prepareChunks(content, shouldEscapeMarkdown)) {
		await channel.send({
			...baseOptions,
			allowedMentions: { parse: [] },
			content: chunk,
		});
	}
}
