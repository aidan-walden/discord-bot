import { Hono } from "hono";
import type { AppContext } from "../../../context";

const metrics = new Hono<AppContext>();

metrics.get("/footprint", (c) => {
  // TODO: CPU usage
  const uptime = process.uptime();
  const memory = process.memoryUsage();

  const response = {
    uptime: uptime,
    memory: memory.rss,
  };

  return c.json(response);
});

export default metrics;
