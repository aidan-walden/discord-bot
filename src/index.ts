import { parseArgs } from "node:util";
import { Events } from "discord.js";
import { loadConfig } from "./config";
import Bot from "./models/Bot";

const { values } = parseArgs({
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
			description: "Remove commands from the Discord API.",
		},
		guild: {
			type: "string",
			description:
				"The guild ID to deploy the commands to. If not provided, commands will be deployed/removed globally.",
		},
	},
	allowPositionals: true,
	strict: true,
});

if (values.sync && values.remove) {
	console.error("Sync and remove options cannot be used together.");
	process.exit(1);
}

const config = await loadConfig();
const client = new Bot(
	values.sync,
	values.remove,
	values.guild,
	config.lavalink.nodes,
	config.ADMIN_USER_IDS,
);

client.once(Events.ClientReady, (readyClient) => {
	console.log(`Logged in as ${readyClient.user.tag}`);
});

client.login(config.BOT_TOKEN);
