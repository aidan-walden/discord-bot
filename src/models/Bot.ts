/**
 * Main bot class that extends the Discord.js Client class.
 * This class exists so that we can easily add properties and methods to the bot.
 */
import { Client, Collection, GatewayIntentBits, Routes, type ClientEvents } from "discord.js";
import type Command from "./Command";
import path from "node:path";
import type BotEvent from "./BotEvent";
import fs from "node:fs/promises";

export default class Bot extends Client {
    commands: Collection<string, Command>;

    constructor() {
        super({ intents: [GatewayIntentBits.Guilds] });
        this.commands = new Collection<string, Command>();
        this.registerCommands(path.join(import.meta.dirname, "../commands")).catch((error) => {
            console.error("Error registering commands:", error);
        });
        
        this.registerEvents(path.join(import.meta.dirname, "../events")).catch((error) => {
            console.error("Error registering events:", error);
        });
    }

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
    
    async deployCommands(guildId: string | undefined ): Promise<void> {
        if (!this.user) {
            throw new Error("Bot user not found");
        }
    
        if (guildId) {
            await this.rest.put(Routes.applicationGuildCommands(this.user.id, guildId), {
                body: this.commands.map((command) => command.data.toJSON()),
            });
        } else {
            await this.rest.put(Routes.applicationCommands(this.user.id), {
                body: this.commands.map((command) => command.data.toJSON()),
            });
        }
    }
}