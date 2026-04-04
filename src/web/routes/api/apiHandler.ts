import { Hono } from "hono";
import type Bot from "../../../models/Bot";
import type { Snowflake } from "discord.js";

const api = new Hono();

export interface GuildListingItem {
  name: string;
  id: Snowflake;
  icon: string | null;
  available: boolean;
}

export function createApiHandler(bot: Bot) {
  // TODO: Dynamically create routes like we do with commands
  api.get("/listGuilds", (c) => {
    const guilds = bot.guilds.cache.map((guild) => {
      return {
        name: guild.name,
        id: guild.id,
        icon: guild.icon,
        available: guild.available,
      } as GuildListingItem;
    });
    return c.json(guilds);
  });

  return api;
}
