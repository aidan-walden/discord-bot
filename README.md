# discord-bot
A modular Discord bot written in TypeScript for the Bun JS runtime. This repository represents a rewrite of the original project using Bun, as the original was never uploaded to GitHub and was subsequently lost.

## Setup

Make sure that these values are defined in `config.yml`

- `BOT_TOKEN`: Discord bot token
- `OPENAI_API_TOKEN`: optional OpenAI API token, used for ChatGPT sessions
- `ADMIN_USER_IDS`: list of Discord user IDs treated as bot admins
- `lavalink.nodes`: Lavalink node configuration

### Building Shoukaku Type Definitions

The `shoukaku` package requires a manual build step to generate proper TypeScript definitions:

```bash
cd node_modules/shoukaku
bun run build:ts
cd dist
ln -s ../src src
```

I'm not sure why this is necessary, but it may be due to the fact that Bun is not officially supported by this package.
