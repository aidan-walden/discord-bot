# discord-bot
A modular Discord bot written in TypeScript for the Bun JS runtime. This repository represents a rewrite of the original project using Bun, as the original was never uploaded to GitHub and was subsequently lost.

## Setup

Install dependencies with `bun install`.

Make sure that these values are defined in `config.yml`

- `BOT_TOKEN`: Discord bot token
- `OPENAI_API_TOKEN`: optional OpenAI API token, used for ChatGPT sessions
- `ADMIN_USER_IDS`: list of Discord user IDs treated as bot admins
- `lavalink.nodes`: Lavalink node configuration

## Dev Environment Setup

In addition to running `bun install`, also ensure that the following system-wide dependencies are installed:
- podman
- podman-compose

These are used by the test script in order to spin up test databases.

Before running the test suite for the first time, the command `podman pull docker.io/library/postgres:17` must be ran in order to ensure the correct postgres image is present and usable.

## Testing

Run `bun run test` (and **don't use** `bun test`).
