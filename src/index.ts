import { Events } from "discord.js";
import Bot from "./models/Bot";

if (process.env.DISCORD_TOKEN === undefined) {
	console.error("Environment variable DISCORD_TOKEN must be set.");
	process.exit(1);
}

const client = new Bot();

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Logged in as ${readyClient.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
