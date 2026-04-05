import { createMiddleware } from "hono/factory";
import type Bot from "../models/Bot";

type Variables = {
	bot: Bot;
};

export type AppContext = { Variables: Variables };

export function injectBot(bot: Bot) {
	return createMiddleware<AppContext>(async (c, next) => {
		c.set("bot", bot);
		await next();
	});
}
