import type { Snowflake } from "discord.js";
import { Hono } from "hono";
import type { AppContext } from "../../../context";

const guilds = new Hono<AppContext>();

interface GuildListingItem {
	name: string;
	id: Snowflake;
	icon: string | null;
	available: boolean;
}

guilds.get("/listGuilds", (c) => {
	const bot = c.get("bot");
	const guilds: GuildListingItem[] = bot.guilds.cache.map((guild) => {
		return {
			name: guild.name,
			id: guild.id,
			icon: guild.icon,
			available: guild.available,
		};
	});

	const response = {
		count: guilds.length,
		guilds: guilds,
	};

	return c.json(response);
});

export default guilds;
