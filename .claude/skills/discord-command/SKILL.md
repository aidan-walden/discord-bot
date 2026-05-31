---
name: discord-command
description: Guide for writing Discord bot slash commands in this project. Use when the user asks you to create, add, or implement a new (slash) command for the bot.
---

# Discord Command Guide

## File location

Place every new command in `src/commands/<category>/<name>.ts`. The bot auto-discovers all `.ts` files in subdirectories of `src/commands/` — no manual registration needed.

## Class structure

```ts
import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type Command from "../../models/Command";

export default class MyCommand implements Command {
    data = new SlashCommandBuilder()
        .setName("mycommand")
        .setDescription("Does something");

    async execute(interaction: ChatInputCommandInteraction): Promise<void> {
        // ...
        await interaction.reply("Done");
    }
}
```

- `data`, `execute` are required; `autocomplete` is optional
- The class must be the default export

## Rules

### deferReply
Only call `interaction.deferReply()` for operations expected to take **more than 3 seconds**. Do not use it speculatively or "just in case".

### Argument validation — early-return pattern
Always check nullable options immediately and return early with an ephemeral error:

```ts
const vol = interaction.options.getInteger("vol");
if (vol === null) {
    await interaction.reply({ content: "You must specify a volume.", flags: MessageFlags.Ephemeral });
    return;
}
```

Always use `MessageFlags.Ephemeral` for error/failure replies unless the user explicitly says otherwise.

### Always reply
A reply **must** always be sent. If branching logic makes it unclear, check `interaction.replied`:

```ts
if (!interaction.replied) {
    await interaction.reply({ content: "Something went wrong.", flags: MessageFlags.Ephemeral });
}
```

## Permissions

`interaction.client.bot.permissions` is a `PermissionService` instance with three `BanRepository` fields: `musicUserBans`, `musicGuildBans`, `gptUserBans`.

**Admin check** — always use `isAdminUser`, no wiring needed:

```ts
if (!interaction.client.bot.permissions.isAdminUser(interaction.user.id)) {
    await interaction.reply({ content: "You don't have permission to use this command.", flags: MessageFlags.Ephemeral });
    return;
}
```

Admin user IDs come from `config.ADMIN_USER_IDS` and are passed into `PermissionService` as a `ReadonlySet<string>`. Never check admin status any other way — always use `isAdminUser`.

**Ban gate** — if the user requests a simple allow/deny ban check:

- Add a new `BanRepository` instance in `src/models/Bot.ts`, wire it to `PermissionService`, then use it in the command's `execute`.

**If the request is more complex than an admin check or a ban gate — stop.** Tell the user this is not implemented in the permission model yet and ask for explicit approval before proceeding.

## Autocomplete

Add an `autocomplete` method when any option uses `.setAutocomplete(true)`:

```ts
async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = ["foo", "bar"].filter(c => c.includes(focused)).slice(0, 25);
    await interaction.respond(choices.map(c => ({ name: c, value: c })));
}
```
