# discord-bot
A modular Discord bot written in TypeScript for the Bun JS runtime. This repository represents a rewrite of the original project using Bun, as the original was never uploaded to GitHub and was subsequently lost.

## Setup

Install dependencies with `bun install`.

Make sure that these values are defined in `config.yml`

- `BOT_TOKEN`: Discord bot token
- `openai.OPENAI_API_TOKEN` / `anthropic.ANTHROPIC_API_TOKEN`: optional LLM provider keys for the AI assistant. Preference is OpenAI then Anthropic — the first with a key is used, and requests fail over to the next when the primary's key is rejected. Anthropic defaults to `claude-haiku-4-5` when `ANTHROPIC_MODEL` is unset; OpenAI requires `OPENAI_MODEL`.
- `llm.userRequestsPerHour`: optional rolling per-user LLM request limit. Defaults to `5`. Admins are exempt, and the admin panel can save per-user overrides (`-1` means unlimited).
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
