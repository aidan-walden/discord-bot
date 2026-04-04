import { Hono } from "hono";
import type Bot from "../models/Bot";
import { createApiHandler } from "./routes/api/apiHandler";

const PORT = 3000;
const app = new Hono();

export function startWebServer(bot: Bot): void {
  app.get("/", (c) => c.html("Hello from discord-bot"));
  app.route("/api", createApiHandler(bot));

  Bun.serve({
    port: PORT,
    fetch: app.fetch,
  });

  console.log(`Admin web UI listening on http://localhost:${PORT}`);
}
