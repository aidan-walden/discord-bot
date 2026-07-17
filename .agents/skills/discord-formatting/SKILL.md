---
name: discord-formatting
description: Enforces discord.js formatter functions for Discord mentions, timestamps, emojis, markdown, and links. Use when writing or modifying bot messages, embeds, command responses, event notices, or any Discord-rendered text in this project.
---

# Discord Formatting

## Rule

For every Discord-rendered mention, timestamp, emoji, markdown construct, or masked link, **MUST** use the corresponding formatter exported by `discord.js`. **NEVER** hand-roll Discord formatting syntax with string interpolation, concatenation, or literal markup.

Import formatter functions directly from `discord.js`; do not use the legacy `Formatters` class.

```ts
import { userMention } from "discord.js";

// BAD: manual mention markup
const content = `<@${user.id}> is not in a voice channel.`;

// GOOD: discord.js formatter
const content = `${userMention(user.id)} is not in a voice channel.`;
```

## Formatter mapping

| Discord output | Use |
| --- | --- |
| User mention | `userMention(userId)` |
| Channel mention | `channelMention(channelId)` |
| Role mention | `roleMention(roleId)` |
| Slash-command mention | `chatInputApplicationCommandMention(...)` |
| Custom emoji | `formatEmoji(emojiId[, animated])` |
| Timestamp | `time(dateOrTimestamp[, style])` |
| Inline code | `inlineCode(content)` |
| Code block | `codeBlock([language,] content)` |
| Bold, italic, underline, strikethrough | `bold`, `italic`, `underline`, `strikethrough` |
| Spoiler, quote | `spoiler`, `blockQuote`, `quote` |
| Masked link | `hyperlink(text, url[, title])` |
| Escape user-controlled Markdown | `escapeMarkdown(content)` |
| Escape user-controlled mentions | `escapeMentions(content)` |

## Examples

```ts
import {
    bold,
    channelMention,
    codeBlock,
    escapeMarkdown,
    roleMention,
    time,
    userMention,
} from "discord.js";

const content = [
    `${userMention(member.id)} joined ${channelMention(channel.id)}.`,
    `${roleMention(role.id)}: ${bold("action required")}.`,
    `Started ${time(Date.now(), "R")}.`,
    codeBlock("json", JSON.stringify(payload, null, 2)),
    `Search: ${escapeMarkdown(query)}`,
].join("\n");
```

Do not write literal Discord syntax such as `<@...>`, `<#...>`, `<@&...>`, `<:...:>`, `<t:...>`, `**...**`, `` `...` ``, `||...||`, `> ...`, or `[text](url)` when a formatter exists.

Raw user-supplied content is not formatting. Escape it when rendering it in a context where Markdown or mentions would be unsafe; do not mutate it otherwise.
