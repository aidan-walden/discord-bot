# Repository Guide

## Stack
- Runtime: Bun with TypeScript ESM.
- Bot framework: `discord.js`.
- Music: direct `kazagumo` dependency on top of pinned GitHub `shoukaku` plus external Lavalink nodes from `config.yml`.
- Web/admin surface: Hono served with `Bun.serve`.
- Persistence: Postgres through `Bun.sql`. Do not add `pg`, `postgres`, or `postgres.js`.
- Prefer Bun-native file APIs such as `Bun.file(...).text()` / `.json()` for file reads and writes; keep `node:fs` only where Bun does not cover the need well, such as directory traversal.

## Entry Points
- [`src/index.ts`](/Users/aidanwalden/Documents/Programming/discord-bot/src/index.ts) loads config, initializes the bot, optionally syncs/removes slash commands, logs in, and starts the web server.
- [`src/models/Bot.ts`](/Users/aidanwalden/Documents/Programming/discord-bot/src/models/Bot.ts) wires Discord, OpenAI, database access, repositories, metrics, Kazagumo music setup, commands, and event registration.
- [`src/web/server.ts`](/Users/aidanwalden/Documents/Programming/discord-bot/src/web/server.ts) mounts the Hono API under `/api` and serves a simple root response.

## Config
- Runtime config comes from `config.yml`. Flat env vars override nested YAML paths: `BOT_TOKEN` / `DATABASE_URL` / `BOT_OWNER_ID` (top-level), `OPENAI_API_TOKEN` / `OPENAI_MODEL` → `openai.*`, `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` → `spotify.*`, `TIKTOK_SESSION_ID` → `tiktok.*`, `IMGUR_CLIENT_ID` → `imgur.*`, `RIOT_API_KEY` → `riot.RIOT_API_KEY`.
- Required config for normal startup: `BOT_TOKEN`, `BOT_OWNER_ID`, `DATABASE_URL`, and at least one Lavalink node.
- `openai.OPENAI_API_TOKEN` and `openai.OPENAI_MODEL` are optional together; ChatGPT commands stay registered but report unavailable when unset.
- `spotify.SPOTIFY_CLIENT_ID` and `spotify.SPOTIFY_CLIENT_SECRET` are optional together; without them the Spotify ↔ Apple Music link converter (`src/events/MusicLinkConvert.ts`) silently stays idle. Apple Music uses the anonymous `node-apple-music` client and needs no credentials.
- `riot.RIOT_API_KEY` is optional; without it `RiotGamesService` reports unavailable (LoL stats consumers stay idle). Nested `riot.pollIntervalSeconds` (default 60) and `riot.players` (`puuid`/`platform`) drive the optional match/rank poller. Solo rank history (max 5 per puuid) is in `riot_rank_history`. Match store (`riot_matches` / `riot_match_participants`) + per-puuid sync cursor (`riot_match_sync`) drive playtime. Discord ↔ Riot links (`riot_user_links`, puuid PK, multiple links per Discord user) power `/lol map` and `/lol view`. HTTP client lives under `src/services/riot/`.

## Commands And Events
- Commands live under `src/commands/<category>/*.ts` and are auto-registered by directory scan.
- Event handlers live under `src/events/*.ts` and are auto-registered on startup.
- Keep new command/event modules side-effect free except for their exported class.

## Persistence
- [`src/database/migrate.ts`](/Users/aidanwalden/Documents/Programming/discord-bot/src/database/migrate.ts) creates tables on startup; there is no separate migration tool.
- Current persisted data: GPT user bans, music user bans, music guild bans, user unboxing balances, deafen sessions/summaries, Riot solo rank history, Riot matches/participants/sync, Discord ↔ Riot user links (smurfs allowed), guild settings (main channel), and bot-wide Secret Santa draws (`secret_santa_*`).
- Repositories in `src/repositories` should accept `typeof Bun.sql` and use parameterized queries.

## Workflow
- Run `bun install` after dependency changes to refresh `bun.lock` and `node_modules`.
- Primary checks: `bun run test`, `bun run typecheck`, and `bun run check`.
- Use `bun run format` for automated formatting and lint fixes; do not make formatting-only changes by hand.
- GitHub Actions CI installs with `bun install --frozen-lockfile`, runs typecheck, runs `bun test` against Postgres 17, then runs `bun run check`.
- `bun run check` includes `AGENTS.md`; keep this file present and broadly useful.
- If you make architectural changes, replace outdated guidance here instead of appending.
