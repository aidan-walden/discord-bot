import { describe, expect, test } from "bun:test";
import { codeBlock } from "discord.js";
import { sendLongMessage } from "./sendLongMessage";

describe("sendLongMessage", () => {
	test("sends short messages in a single chunk", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;

		await sendLongMessage(channel, "hello");

		expect(calls).toEqual([
			{ content: "hello", allowedMentions: { parse: [] } },
		]);
	});

	test("passes through base message options", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;

		await sendLongMessage(channel, "hello", { allowedMentions: { parse: [] } });

		expect(calls).toEqual([
			{
				allowedMentions: { parse: [] },
				content: "hello",
			},
		]);
	});

	test("splits long messages on newline boundaries when possible", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;
		const firstLine = "a".repeat(1990);
		const secondLine = "b".repeat(20);
		const content = `${firstLine}\n${secondLine}`;

		await sendLongMessage(channel, content);

		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual({
			content: firstLine,
			allowedMentions: { parse: [] },
		});
		expect(calls[1]).toEqual({
			content: secondLine,
			allowedMentions: { parse: [] },
		});
	});

	test("splits long messages at the hard limit when no newline exists", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;
		const content = "x".repeat(2500);

		await sendLongMessage(channel, content);

		expect(calls).toHaveLength(2);
		expect((calls[0]?.content as string | undefined)?.length).toBe(2000);
		expect((calls[1]?.content as string | undefined)?.length).toBe(500);
	});

	test("escapes Markdown and disables mentions by default", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;

		await sendLongMessage(channel, "**important** @everyone");

		expect(calls).toEqual([
			{
				content: "\\*\\*important\\*\\* @everyone",
				allowedMentions: { parse: [] },
			},
		]);
	});

	test("skips Markdown escaping when shouldEscapeMarkdown is false", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;

		await sendLongMessage(channel, "**bold**", {}, false);

		expect(calls).toEqual([
			{ content: "**bold**", allowedMentions: { parse: [] } },
		]);
	});

	test("keeps short code blocks unescaped when shouldEscapeMarkdown is false", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;
		const content = codeBlock("hi");

		await sendLongMessage(channel, content, {}, false);

		expect(calls).toEqual([{ content, allowedMentions: { parse: [] } }]);
	});

	test("re-fences each chunk when a code block exceeds the limit", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = {
			send: async (options: Record<string, unknown>) => {
				calls.push(options);
			},
		} as never;
		const lines = Array.from(
			{ length: 100 },
			(_, i) => `line-${i}-${"x".repeat(30)}`,
		);
		const content = codeBlock(lines.join("\n"));

		await sendLongMessage(channel, content, {}, false);

		expect(calls.length).toBeGreaterThan(1);
		const bodies: string[] = [];
		for (const call of calls) {
			const chunk = call.content as string;
			expect(chunk.length).toBeLessThanOrEqual(2000);
			expect(chunk.startsWith("```\n")).toBe(true);
			expect(chunk.endsWith("\n```")).toBe(true);
			expect(chunk.includes("\\`")).toBe(false);
			bodies.push(chunk.slice(4, -4));
		}
		expect(bodies.join("\n")).toBe(lines.join("\n"));
	});
});
