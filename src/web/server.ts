import { Hono } from "hono";
import type Bot from "../models/Bot";
import { injectBot } from "./context";
import api from "./routes/api/apiHandler";

const PORT = 3000;
const app = new Hono();

export function startWebServer(bot: Bot): void {
  app.use("*", injectBot(bot));
  app.get("/", (c) => c.html("Hello from discord-bot"));
  app.route("/api", api);

  Bun.serve({
    port: PORT,
    fetch: app.fetch,
  });

  console.log(`Admin web UI listening on http://localhost:${PORT}`);
}
