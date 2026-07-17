import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type Bot from "../../models/Bot";
import type { AppContext } from "../context";
import metrics from "./metrics";

function createMockBot(): Bot {
	const config = new Map<string, string | undefined>([
		["OPENAI_API_TOKEN", "openai-secret"],
		["SPOTIFY_CLIENT_ID", "spotify-client"],
		["SPOTIFY_CLIENT_SECRET", "  "],
		["TIKTOK_SESSION_ID", "tiktok-secret"],
		["IMGUR_CLIENT_ID", undefined],
	]);

	return {
		metrics: {
			uptime: 123.45,
			cpu: 12.5,
			memory: { rss: 100, heapUsed: 50, heapTotal: 75 },
			commandExecutions: new Map([
				["ping", 3],
				["play", 1],
			]),
			credentialRejections: new Set(["spotify"]),
		},
		guilds: {
			cache: new Map([
				["guild-1", { memberCount: 10 }],
				["guild-2", { memberCount: 20 }],
			]),
		},
		config: {
			get: (key: string) => config.get(key),
		},
	} as unknown as Bot;
}

function createApp(bot: Bot = createMockBot()) {
	const app = new Hono<AppContext>();
	app.use("*", async (c, next) => {
		c.set("bot", bot);
		await next();
	});
	app.route("/metrics", metrics);
	return app;
}

describe("prometheus metrics route", () => {
	test("GET /metrics exposes process, bot usage, and credential metrics", async () => {
		const response = await createApp().request("/metrics");
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"text/plain; version=0.0.4; charset=utf-8",
		);
		expect(body).toContain("# TYPE discord_bot_uptime_seconds gauge");
		expect(body).toContain("discord_bot_uptime_seconds 123.45");
		expect(body).toContain('discord_bot_memory_bytes{type="rss"} 100');
		expect(body).toContain("discord_bot_guilds 2");
		expect(body).toContain("discord_bot_guild_memberships 30");
		expect(body).toContain('discord_bot_commands_total{command="ping"} 3');
		expect(body).toContain(
			'discord_bot_external_api_credentials_configured{provider="openai"} 1',
		);
		expect(body).toContain(
			'discord_bot_external_api_credentials_configured{provider="spotify"} 0',
		);
		expect(body).toContain(
			'discord_bot_external_api_credentials_configured{provider="tiktok"} 1',
		);
		expect(body).toContain(
			'discord_bot_external_api_credentials_configured{provider="imgur"} 0',
		);
		expect(body).toContain(
			'discord_bot_external_api_credentials_rejected{provider="openai"} 0',
		);
		expect(body).toContain(
			'discord_bot_external_api_credentials_rejected{provider="spotify"} 1',
		);
		expect(body).not.toContain("openai-secret");
		expect(body).not.toContain("tiktok-secret");
		expect(body.endsWith("\n")).toBe(true);
	});
});
