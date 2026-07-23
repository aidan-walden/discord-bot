import { Hono } from "hono";
import type Bot from "../../models/Bot";
import { EXTERNAL_API_PROVIDERS } from "../../services/ExternalApiCredentialStatus";
import type { AppContext } from "../context";

const metrics = new Hono<AppContext>();

function isConfigured(value: string | undefined): boolean {
	return Boolean(value?.trim());
}

function escapeLabelValue(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("\n", "\\n")
		.replaceAll('"', '\\"');
}

function addMetric(
	lines: string[],
	name: string,
	help: string,
	type: "counter" | "gauge",
	values: string[],
): void {
	lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...values);
}

export function renderPrometheusMetrics(bot: Bot): string {
	const lines: string[] = [];
	const memory = bot.metrics.memory;

	addMetric(
		lines,
		"discord_bot_uptime_seconds",
		"Discord bot process uptime in seconds.",
		"gauge",
		[`discord_bot_uptime_seconds ${bot.metrics.uptime}`],
	);
	addMetric(
		lines,
		"discord_bot_cpu_usage_percent",
		"Discord bot process CPU usage percentage.",
		"gauge",
		[`discord_bot_cpu_usage_percent ${bot.metrics.cpu}`],
	);
	addMetric(
		lines,
		"discord_bot_memory_bytes",
		"Discord bot process memory usage in bytes.",
		"gauge",
		[
			`discord_bot_memory_bytes{type="rss"} ${memory.rss}`,
			`discord_bot_memory_bytes{type="heap_used"} ${memory.heapUsed}`,
			`discord_bot_memory_bytes{type="heap_total"} ${memory.heapTotal}`,
		],
	);

	let guildMemberships = 0;
	for (const guild of bot.guilds.cache.values()) {
		guildMemberships += guild.memberCount;
	}
	addMetric(
		lines,
		"discord_bot_guilds",
		"Number of Discord guilds cached by the bot.",
		"gauge",
		[`discord_bot_guilds ${bot.guilds.cache.size}`],
	);
	addMetric(
		lines,
		"discord_bot_guild_memberships",
		"Sum of member counts across Discord guilds cached by the bot.",
		"gauge",
		[`discord_bot_guild_memberships ${guildMemberships}`],
	);

	const commandValues = [...bot.metrics.commandExecutions.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(
			([command, count]) =>
				`discord_bot_commands_total{command="${escapeLabelValue(command)}"} ${count}`,
		);
	addMetric(
		lines,
		"discord_bot_commands_total",
		"Number of recognized slash command dispatches.",
		"counter",
		commandValues,
	);

	const spotify = bot.config.get("spotify");
	const spotifyConfigured =
		isConfigured(spotify.SPOTIFY_CLIENT_ID) &&
		isConfigured(spotify.SPOTIFY_CLIENT_SECRET);
	const credentialStatuses = [
		["openai", isConfigured(bot.config.get("openai").OPENAI_API_TOKEN)],
		[
			"anthropic",
			isConfigured(bot.config.get("anthropic").ANTHROPIC_API_TOKEN),
		],
		["spotify", spotifyConfigured],
		["tiktok", isConfigured(bot.config.get("tiktok").TIKTOK_SESSION_ID)],
		["imgur", isConfigured(bot.config.get("imgur").IMGUR_CLIENT_ID)],
		["riot", isConfigured(bot.config.get("riot").RIOT_API_KEY)],
	] as const;
	addMetric(
		lines,
		"discord_bot_external_api_credentials_configured",
		"Whether optional external API credentials are configured.",
		"gauge",
		credentialStatuses.map(
			([provider, configured]) =>
				`discord_bot_external_api_credentials_configured{provider="${provider}"} ${configured ? 1 : 0}`,
		),
	);
	addMetric(
		lines,
		"discord_bot_external_api_credentials_rejected",
		"Whether an external API credential rejection has been observed since process start.",
		"gauge",
		EXTERNAL_API_PROVIDERS.map(
			(provider) =>
				`discord_bot_external_api_credentials_rejected{provider="${provider}"} ${bot.metrics.credentialRejections.has(provider) ? 1 : 0}`,
		),
	);

	return `${lines.join("\n")}\n`;
}

metrics.get("/", (c) => {
	return c.body(renderPrometheusMetrics(c.get("bot")), 200, {
		"Content-Type": "text/plain; version=0.0.4; charset=utf-8",
	});
});

export default metrics;
