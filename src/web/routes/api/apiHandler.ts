import { Hono } from "hono";
import type { AppContext } from "../../context";
import guilds from "./guilds/guilds";
import metrics from "./metrics/metrics";

const api = new Hono<AppContext>();

api.route("/guilds", guilds);
api.route("/metrics", metrics);

export default api;
