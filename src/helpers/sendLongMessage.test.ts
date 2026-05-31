import { describe, expect, test } from "bun:test";
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

		expect(calls).toEqual([{ content: "hello" }]);
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
		expect(calls[0]).toEqual({ content: firstLine });
		expect(calls[1]).toEqual({ content: secondLine });
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
		expect((calls[0]?.content as string).length).toBe(2000);
		expect((calls[1]?.content as string).length).toBe(500);
	});
});
