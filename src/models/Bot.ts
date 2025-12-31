/**
 * Main bot class that extends the Discord.js Client class.
 * This class exists so that we can easily add properties and methods to the bot.
 */
import { Client, Collection, Events, GatewayIntentBits, Routes, type ClientEvents, type RESTGetAPIApplicationCommandsResult, type RESTGetAPIApplicationGuildCommandsResult, type Snowflake } from "discord.js";
import type Command from "./Command";
import path from "node:path";
import type BotEvent from "./BotEvent";
import fs from "node:fs/promises";

export default class Bot extends Client {
    commands: Collection<string, Command>;

    constructor(shouldDeployCommands: boolean = false, shouldRemoveCommands: boolean = false, guildId: string | undefined = undefined) {
        super({ intents: [GatewayIntentBits.Guilds] });
        this.commands = new Collection<string, Command>();
        this.registerCommands(path.join(import.meta.dirname, "../commands")).catch((error) => {
            console.error("Error registering commands:", error);
        });

        this.registerEvents(path.join(import.meta.dirname, "../events")).catch((error) => {
            console.error("Error registering events:", error);
        });

        // Bot must be ready to deploy or remove commands, as we need to access the bot user's ID.
        this.once(Events.ClientReady, async () => {
            if (shouldDeployCommands) {
                await this.deployCommands(guildId).catch((error) => {
                    console.error("Error deploying commands:", error);
                });
            }
            if (shouldRemoveCommands) {
                await this.removeCommands(guildId).catch((error) => {
                    console.error("Error removing commands:", error);
                });
            }
        });
    }

    /**
     * Register all events in the given directory, to be executed by the bot when the event is triggered.
     * @param {string} rootDir - The root directory to search for event files.
     */
    async registerEvents(rootDir: string): Promise<void> {
        const eventFiles = (await fs.readdir(rootDir)).filter((file) => file.endsWith(".ts"));
        for (const file of eventFiles) {
            const filePath = path.join(rootDir, file);
            
            // Create instance of event class before accessing its properties
            const EventClass = (await import(filePath)).default as new () => BotEvent;
            const event = new EventClass();
            if (event.once) {
                this.once(event.event as keyof ClientEvents, (...args) => event.execute(this, ...args));
            } else {
                this.on(event.event as keyof ClientEvents, (...args) => event.execute(this, ...args));
            }
        }
    }

    /**
     * Register all commands in the given directory, to be executed by the bot when the command is triggered.
     * @param {string} rootDir - The root directory to search for command files.
     */
    async registerCommands(rootDir: string): Promise<void> {
        const commandFolders = await fs.readdir(rootDir);
        for (const folder of commandFolders) {
            const commandFolderPath = path.join(rootDir, folder);
            const commandFiles = (await fs.readdir(commandFolderPath)).filter((file) => file.endsWith(".ts"));
            for (const file of commandFiles) {
                const filePath = path.join(commandFolderPath, file);
    
                // Create instance of command class before accessing its properties
                const CommandClass = (await import(filePath)).default as new () => Command;
                const command = new CommandClass();
                this.commands.set(command.data.name, command);
            }
        }
    }
    
    /**
     * Deploy all registered commands to the given guild, or globally if no guild is provided.
     * @param {string} guildId - The guild ID to deploy the commands to.
     * @throws {Error} If the bot user is not found.
     */
    async deployCommands(guildId: string | undefined ): Promise<void> {
        if (!this.user) {
            throw new Error("Bot user not found");
        }
    
        if (guildId) {
            console.log(`Deploying commands to guild ${guildId}...`);
            await this.rest.put(Routes.applicationGuildCommands(this.user.id, guildId), {
                body: this.commands.map((command) => command.data.toJSON()),
            });
            console.log(`Done deploying commands to guild ${guildId}`);
        } else {
            console.log(`Deploying commands globally...`);
            await this.rest.put(Routes.applicationCommands(this.user.id), {
                body: this.commands.map((command) => command.data.toJSON()),
            });
            console.log(`Done deploying commands globally`);
        }
    }

    /**
     * Remove all deployed commands from the given guild, or globally if no guild is provided.
     * @param {string} guildId - The guild ID to remove the commands from.
     * @throws {Error} If the bot user is not found.
     */
    async removeCommands(guildId: string | undefined ): Promise<void> {
        if (!this.user) {
            throw new Error("Bot user not found");
        }

        if (guildId) {
            console.log(`Removing deployed commands from guild ${guildId}...`);
            const commands = await this.rest.get(Routes.applicationGuildCommands(this.user.id, guildId)) as RESTGetAPIApplicationGuildCommandsResult;
            for (const command of commands) {
                await this.rest.delete(Routes.applicationGuildCommand(this.user.id, guildId, command.id));
            }
            console.log(`Done removing commands from guild ${guildId}`);
        } else {
            console.log(`Removing deployed commands globally...`);
            const commands = await this.rest.get(Routes.applicationCommands(this.user.id)) as RESTGetAPIApplicationCommandsResult;
            for (const command of commands) {
                await this.rest.delete(Routes.applicationCommand(this.user.id, command.id as Snowflake));
            }
            console.log(`Done removing commands globally`);
        }
    }
}