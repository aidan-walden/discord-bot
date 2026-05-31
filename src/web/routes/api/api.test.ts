import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppContext } from "../../context";
import api from "./apiHandler";

function createMockBot() {
	return {
		guilds: {
			cache: {
				map<T>(
					callback: (guild: {
						name: string;
						id: string;
						icon: string | null;
						available: boolean;
					}) => T,
				): T[] {
					return [
						callback({
							name: "Guild One",
							id: "guild-1",
							icon: "icon-hash",
							available: true,
						}),
						callback({
							name: "Guild Two",
							id: "guild-2",
							icon: null,
							available: false,
						}),
					];
				},
			},
		},
		metrics: {
			uptime: 123.45,
			memory: {
				rss: 100,
				heapUsed: 50,
				heapTotal: 75,
			},
			cpu: 12.5,
		},
	};
}

function createApp() {
	const app = new Hono<AppContext>();
	app.use("*", async (c, next) => {
		c.set("bot", createMockBot() as never);
		await next();
	});
	app.route("/api", api);
	return app;
}

describe("api routes", () => {
	test("GET /api/guilds/listGuilds returns cached guild listings", async () => {
		const response = await createApp().request("/api/guilds/listGuilds");

		expect(response.status).toBe(200);
		expect(response.json()).resolves.toEqual({
			count: 2,
			guilds: [
				{
					name: "Guild One",
					id: "guild-1",
					icon: "icon-hash",
					available: true,
				},
				{
					name: "Guild Two",
					id: "guild-2",
					icon: null,
					available: false,
				},
			],
		});
	});

	test("GET /api/metrics/footprint returns bot metrics", async () => {
		const response = await createApp().request("/api/metrics/footprint");

		expect(response.status).toBe(200);
		expect(response.json()).resolves.toEqual({
			uptime: 123.45,
			memory: {
				rss: 100,
				heapUsed: 50,
				heapTotal: 75,
			},
			cpuPercent: 12.5,
		});
	});
});
