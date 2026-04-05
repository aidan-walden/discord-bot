import { Hono } from "hono";
import type { AppContext } from "../../../context";

const metrics = new Hono<AppContext>();

metrics.get("/footprint", (c) => {
	const bot = c.get("bot");

	const response = {
		uptime: bot.metrics.uptime,
		memory: bot.metrics.memory,
		cpuPercent: bot.metrics.cpu,
	};

	return c.json(response);
});

export default metrics;
