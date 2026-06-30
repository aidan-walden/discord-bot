import { Hono } from "hono";
import type { AppContext } from "../context";

const health = new Hono<AppContext>();

health.get("/", async (c) => {
	const bot = c.get("bot");

	const discord = bot.isReady();

	let db = false;
	try {
		await bot.db`select 1`;
		db = true;
	} catch {
		db = false;
	}

	// Informational only: not part of the pass/fail decision. Shoukaku Node
	// state 1 === CONNECTED.
	const nodes = [...bot.music.shoukaku.nodes.values()];
	const lavalink = {
		nodes: nodes.length,
		connected: nodes.filter((n) => n.state === 1).length,
	};

	const healthy = discord && db;

	return c.json(
		{ status: healthy ? "ok" : "degraded", discord, db, lavalink },
		healthy ? 200 : 503,
	);
});

export default health;
