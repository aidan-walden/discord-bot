import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type Bot from "../models/Bot";
import { injectBot } from "./context";

describe("injectBot", () => {
	test("injects the bot instance into request context", async () => {
		const bot = { marker: "bot-123" } as unknown as Bot;
		const app = new Hono<{ Variables: { bot: Bot } }>();
		app.use("*", injectBot(bot));
		app.get("/", (c) =>
			c.json({
				marker: (c.get("bot") as unknown as { marker: string }).marker,
			}),
		);

		const response = await app.request("/");

		expect(response.status).toBe(200);
		expect(response.json()).resolves.toEqual({ marker: "bot-123" });
	});
});
