import { Hono } from "hono";
import type { AppContext } from "../../context";
import guilds from "./guilds/guilds";

const api = new Hono<AppContext>();

api.route("/guilds", guilds);

export default api;
