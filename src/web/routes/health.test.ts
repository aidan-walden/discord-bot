import { describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type Bot from "../../models/Bot";
import type { AppContext } from "../context";
import health from "./health";

function createApp(execute: () => Promise<unknown>) {
	const bot = {
		db: { execute },
		isReady: () => true,
		music: {
			shoukaku: {
				nodes: new Map([
					["ready", { state: 1 }],
					["offline", { state: 0 }],
				]),
			},
		},
	} as unknown as Bot;
	const app = new Hono<AppContext>();
	app.use("*", async (c, next) => {
		c.set("bot", bot);
		await next();
	});
	app.route("/health", health);
	return app;
}

describe("health route", () => {
	test("reports healthy when Discord and Drizzle are ready", async () => {
		const execute = mock(async () => []);
		const response = await createApp(execute).request("/health");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "ok",
			discord: true,
			db: true,
			lavalink: { nodes: 2, connected: 1 },
		});
		expect(execute).toHaveBeenCalledTimes(1);
	});

	test("reports degraded when the Drizzle query fails", async () => {
		const response = await createApp(
			mock(async () => {
				throw new Error("database unavailable");
			}),
		).request("/health");

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({
			status: "degraded",
			discord: true,
			db: false,
		});
	});
});
