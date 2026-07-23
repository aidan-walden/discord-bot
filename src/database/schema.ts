import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

const createdAt = () =>
	timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
	timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

function banTable(name: string, idColumn: string) {
	return pgTable(name, {
		id: text(idColumn).primaryKey(),
		createdAt: createdAt(),
	});
}

export const gptUserBans = banTable("gpt_user_bans", "user_id");
export const musicUserBans = banTable("music_user_bans", "user_id");
export const musicGuildBans = banTable("music_guild_bans", "guild_id");

export const userBalances = pgTable("user_balances", {
	userId: text("user_id").primaryKey(),
	balanceCents: integer("balance_cents").notNull().default(0),
	mostGainedCents: integer("most_gained_cents").notNull().default(0),
	mostLostCents: integer("most_lost_cents").notNull().default(0),
	totalSpentCents: integer("total_spent_cents").notNull().default(0),
	totalGainedCents: integer("total_gained_cents").notNull().default(0),
	unboxCount: integer("unbox_count").notNull().default(0),
	updatedAt: updatedAt(),
});

export const deafenSessions = pgTable(
	"deafen_sessions",
	{
		id: bigint("id", { mode: "bigint" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		userId: text("user_id").notNull(),
		guildId: text("guild_id").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
		endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
		durationSeconds: integer("duration_seconds").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		index("idx_deafen_sessions_user_guild").on(table.userId, table.guildId),
	],
);

export const deafenSummaries = pgTable(
	"deafen_summaries",
	{
		userId: text("user_id").notNull(),
		guildId: text("guild_id").notNull(),
		longestDeafenSeconds: integer("longest_deafen_seconds")
			.notNull()
			.default(0),
		totalDeafenSeconds: integer("total_deafen_seconds").notNull().default(0),
		sessionCount: integer("session_count").notNull().default(0),
		updatedAt: updatedAt(),
	},
	(table) => [
		primaryKey({
			name: "deafen_summaries_pkey",
			columns: [table.userId, table.guildId],
		}),
	],
);

export const riotRankHistory = pgTable(
	"riot_rank_history",
	{
		id: bigint("id", { mode: "bigint" })
			.primaryKey()
			.generatedAlwaysAsIdentity(),
		puuid: text("puuid").notNull(),
		tier: text("tier").notNull(),
		rank: text("rank").notNull(),
		leaguePoints: integer("league_points").notNull(),
		wins: integer("wins").notNull(),
		losses: integer("losses").notNull(),
		detectedAt: timestamp("detected_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [
		index("idx_riot_rank_history_puuid_detected").on(
			table.puuid,
			table.detectedAt.desc(),
		),
	],
);

export const riotUserLinks = pgTable(
	"riot_user_links",
	{
		puuid: text("puuid").primaryKey(),
		userId: text("user_id").notNull(),
		platform: text("platform").notNull(),
		gameName: text("game_name").notNull(),
		tagLine: text("tag_line").notNull(),
		linkedAt: timestamp("linked_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => [index("idx_riot_user_links_user_id").on(table.userId)],
);

export const riotMatches = pgTable("riot_matches", {
	matchId: text("match_id").primaryKey(),
	queueId: integer("queue_id").notNull(),
	gameDuration: integer("game_duration").notNull(),
	gameCreation: timestamp("game_creation", { withTimezone: true }).notNull(),
});

export const riotMatchParticipants = pgTable(
	"riot_match_participants",
	{
		matchId: text("match_id").notNull(),
		puuid: text("puuid").notNull(),
		timePlayed: integer("time_played").notNull(),
		championId: integer("champion_id"),
		win: boolean("win"),
	},
	(table) => [
		primaryKey({
			name: "riot_match_participants_pkey",
			columns: [table.puuid, table.matchId],
		}),
		foreignKey({
			name: "riot_match_participants_match_id_fkey",
			columns: [table.matchId],
			foreignColumns: [riotMatches.matchId],
		}).onDelete("cascade"),
		index("idx_riot_match_participants_match_id").on(table.matchId),
	],
);

export const riotMatchSync = pgTable("riot_match_sync", {
	puuid: text("puuid").primaryKey(),
	lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
	backfilled: boolean("backfilled").notNull().default(false),
	backfillSeconds: bigint("backfill_seconds", { mode: "number" })
		.notNull()
		.default(0),
	/** Cutoff for Riot match durations; wol.gg baseline covers earlier time. */
	backfillAsOf: timestamp("backfill_as_of", { withTimezone: true }),
	updatedAt: updatedAt(),
});

export const guildSettings = pgTable("guild_settings", {
	guildId: text("guild_id").primaryKey(),
	mainChannelId: text("main_channel_id"),
	updatedAt: updatedAt(),
});

export const secretSantaDraws = pgTable("secret_santa_draws", {
	name: text("name").primaryKey(),
	open: boolean("open").notNull().default(true),
	spendLimitCents: integer("spend_limit_cents"),
	drawnAt: timestamp("drawn_at", { withTimezone: true }),
	revision: integer("revision").notNull().default(0),
	createdAt: createdAt(),
});

export const secretSantaParticipants = pgTable(
	"secret_santa_participants",
	{
		drawName: text("draw_name").notNull(),
		userId: text("user_id").notNull(),
	},
	(table) => [
		primaryKey({
			name: "secret_santa_participants_pkey",
			columns: [table.drawName, table.userId],
		}),
		foreignKey({
			name: "secret_santa_participants_draw_name_fkey",
			columns: [table.drawName],
			foreignColumns: [secretSantaDraws.name],
		}).onDelete("cascade"),
	],
);

export const secretSantaExclusions = pgTable(
	"secret_santa_exclusions",
	{
		drawName: text("draw_name").notNull(),
		userA: text("user_a").notNull(),
		userB: text("user_b").notNull(),
	},
	(table) => [
		primaryKey({
			name: "secret_santa_exclusions_pkey",
			columns: [table.drawName, table.userA, table.userB],
		}),
		foreignKey({
			name: "secret_santa_exclusions_draw_name_fkey",
			columns: [table.drawName],
			foreignColumns: [secretSantaDraws.name],
		}).onDelete("cascade"),
		check(
			"secret_santa_exclusions_check",
			sql`${table.userA} < ${table.userB}`,
		),
	],
);

export const secretSantaAssignments = pgTable(
	"secret_santa_assignments",
	{
		drawName: text("draw_name").notNull(),
		giverId: text("giver_id").notNull(),
		recipientId: text("recipient_id").notNull(),
	},
	(table) => [
		primaryKey({
			name: "secret_santa_assignments_pkey",
			columns: [table.drawName, table.giverId],
		}),
		foreignKey({
			name: "secret_santa_assignments_draw_name_fkey",
			columns: [table.drawName],
			foreignColumns: [secretSantaDraws.name],
		}).onDelete("cascade"),
		unique("secret_santa_assignments_draw_name_recipient_id_key").on(
			table.drawName,
			table.recipientId,
		),
	],
);
