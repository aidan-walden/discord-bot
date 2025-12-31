import { Events } from "discord.js";
import Bot from "./models/Bot";
import { parseArgs } from "node:util";

if (process.env.DISCORD_TOKEN === undefined) {
	console.error("Environment variable DISCORD_TOKEN must be set.");
	process.exit(1);
}

const { values, positionals } = parseArgs({
	args: Bun.argv,
	options: {
		sync: {
			type: "boolean",
			default: false,
			description: "Push commands to the Discord API for registration.",
		},
		remove: {
			type: "boolean",
			default: false,
			description: "Remove commands from the Discord API for registration.",
		},
		guild: {
			type: "string",
			description: "The guild ID to deploy the commands to. If not provided, commands will be deployed/removed globally.",
		},
	},
	allowPositionals: true,
	strict: true,
});

if (values.sync && values.remove) {
	console.error("Sync and remove options cannot be used together.");
	process.exit(1);
}

const client = new Bot(values.sync, values.remove, values.guild);

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Logged in as ${readyClient.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
