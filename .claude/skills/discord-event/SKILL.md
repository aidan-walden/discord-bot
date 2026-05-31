---
name: discord-event
description: Guide for writing Discord bot event handlers in this project. Use when the user asks you to create, add, or implement a new event handler or bot event listener.
---

# Discord Event Handler Guide

## File location

Place every new event handler in `src/events/<EventName>.ts`. The bot auto-discovers all `.ts` files directly in `src/events/` — no manual registration needed.

> Note: events currently live flat in `src/events/`, not in category subdirectories.

## Class structure

```ts
import { Events, type <EventArgs> } from "discord.js";
import type Bot from "../models/Bot";
import type BotEvent from "../models/BotEvent";

export default class MyEvent implements BotEvent {
    once = false;
    event: (typeof Events)[keyof typeof Events] = Events.SomeEvent;

    async execute(bot: Bot, ...args: unknown[]): Promise<void> {
        // handler body
    }
}
```

- The class must be the default export and implement `BotEvent`
- Type the event-specific arguments in `execute` (e.g. `message: Message`) — the `...args: unknown[]` signature from the interface is intentionally loose

## Required fields

| Field | Type | Description |
|-------|------|-------------|
| `once` | `boolean` | `true` = fire only on the first occurrence; `false` = fire every time |
| `event` | `(typeof Events)[keyof typeof Events]` | The discord.js `Events` enum value to listen to |
| `execute` | `async (bot: Bot, ...args) => Promise<void>` | Handler body; receives the `Bot` instance and event-specific arguments |

## Context validation — early-return pattern

Validate the event context at the top of `execute` and return early if the handler should not proceed. Do not nest the main logic inside conditionals.

```ts
async execute(bot: Bot, interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) {
        return;
    }
    // main logic here
}
```

Common checks: narrowing the event payload type (`.isChatInputCommand()`, `.isAutocomplete()`, `message.inGuild()`), filtering out bot authors, checking channel or thread state. Apply only the checks relevant to the handler's purpose.

## Choosing `once`

- Use `once = true` for setup events that should only run at startup (e.g. `Events.ClientReady`)
- Use `once = false` for recurring events (e.g. `Events.MessageCreate`, `Events.InteractionCreate`)

## Accessing bot services

The `bot` parameter is the `Bot` instance. Access services via it:

```ts
bot.commands          // Collection of registered commands
bot.permissions       // PermissionService
bot.chatSessions      // ChatSessionService
bot.balances          // UserBalanceRepository
bot.config            // AppConfig
bot.music             // Kazagumo (music player)
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
