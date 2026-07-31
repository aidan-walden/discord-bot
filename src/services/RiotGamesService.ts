import { EventEmitter } from "node:events";
import type RiotMatchRepository from "../repositories/RiotMatchRepository";
import type RiotMatchSyncRepository from "../repositories/RiotMatchSyncRepository";
import type RiotRankHistoryRepository from "../repositories/RiotRankHistoryRepository";
import type RiotUserLinkRepository from "../repositories/RiotUserLinkRepository";
import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";
import {
	DEFAULT_POLL_INTERVAL_SECONDS,
	LOL_VIEW_CACHE_TTL_MS,
	MATCH_IDS_PAGE_SIZE,
	parseRiotId,
	platformToRegion,
	RECENT_MATCH_COUNT,
	SOLO_QUEUE,
} from "./riot/constants";
import RiotApiClient, { type TemporaryStateStore } from "./riot/RiotApiClient";
import type {
	Fetcher,
	RiotAccount,
	RiotActiveGame,
	RiotActiveGameStatus,
	RiotEndedGameStats,
	RiotLeagueEntry,
	RiotLolView,
	RiotMatch,
	RiotPlatform,
	RiotPlayerConfig,
	RiotPlayerPollState,
	RiotRank,
	RiotRankHistoryEntry,
	RiotRegion,
	RiotSummoner,
} from "./riot/types";
import { RiotGamesError } from "./riot/types";
import type WolGgClient from "./wol/WolGgClient";

export {
	FLEX_QUEUE,
	FRIENDLY_REGION_TO_PLATFORM,
	parseFriendlyRegion,
	parseRiotId,
	platformToRegion,
	profileIconUrl,
	queueName,
	RECENT_MATCH_COUNT,
	RIOT_PLATFORMS,
	RIOT_REGIONS,
	SOLO_QUEUE,
} from "./riot/constants";
export type {
	RiotAccount,
	RiotActiveGame,
	RiotActiveGameStatus,
	RiotEndedGameStats,
	RiotLeagueEntry,
	RiotLolView,
	RiotMatch,
	RiotMatchParticipant,
	RiotPlatform,
	RiotPlayerConfig,
	RiotPlayerPollState,
	RiotRank,
	RiotRankHistoryEntry,
	RiotRegion,
	RiotSummoner,
} from "./riot/types";
export { RiotGamesError } from "./riot/types";

export interface RiotGamesServiceOptions {
	fetch?: Fetcher;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	pollIntervalSeconds?: number;
	players?: RiotPlayerConfig[];
	setInterval?: typeof setInterval;
	clearInterval?: typeof clearInterval;
	rankHistory?: RiotRankHistoryRepository;
	matches?: RiotMatchRepository;
	matchSync?: RiotMatchSyncRepository;
	userLinks?: RiotUserLinkRepository;
	wol?: WolGgClient;
	temporaryState?: TemporaryStateStore;
}

interface PersistedPollMemory {
	lastMatchId: string | null;
	mostRecentEnded: RiotEndedGameStats | null;
	currentRank: RiotRank | null;
}

interface LolViewCacheEntry {
	expiresAt: number;
	value: RiotLolView;
}

type RiotGamesServiceEvents = {
	update: [state: RiotPlayerPollState];
};

interface PlayerPollMemory {
	lastMatchId: string | null;
	mostRecentEnded: RiotEndedGameStats | null;
	currentRank: RiotRank | null;
	seededFromDb: boolean;
}

const MATCH_SYNC_OVERLAP_SECONDS = 24 * 60 * 60;

function soloRankFromEntries(entries: RiotLeagueEntry[]): RiotRank | null {
	const solo = entries.find((entry) => entry.queueType === SOLO_QUEUE);
	if (!solo) {
		return null;
	}
	return {
		tier: solo.tier,
		rank: solo.rank,
		leaguePoints: solo.leaguePoints,
		wins: solo.wins,
		losses: solo.losses,
	};
}

/**
 * Riot Games poller + thin API facade for LoL account/match/league lookups.
 * Optional key: unavailable when unset.
 */
export default class RiotGamesService extends EventEmitter<RiotGamesServiceEvents> {
	private readonly client: RiotApiClient;
	private readonly pollIntervalSeconds: number;
	private readonly players: RiotPlayerConfig[];
	private readonly setIntervalFn: typeof setInterval;
	private readonly clearIntervalFn: typeof clearInterval;
	private readonly rankHistory?: RiotRankHistoryRepository;
	private readonly matches?: RiotMatchRepository;
	private readonly matchSync?: RiotMatchSyncRepository;
	private readonly userLinks?: RiotUserLinkRepository;
	private readonly wol?: WolGgClient;
	private readonly now: () => number;
	private readonly temporaryState?: TemporaryStateStore;
	private readonly pollMemory = new Map<string, PlayerPollMemory>();
	private readonly snapshots = new Map<string, RiotPlayerPollState>();
	private readonly lolViewCache = new Map<string, LolViewCacheEntry>();
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private polling = false;

	constructor(
		apiKey: string | null,
		credentialReporter?: CredentialRejectionReporter,
		options: RiotGamesServiceOptions = {},
	) {
		super();
		this.temporaryState = options.temporaryState;
		this.client = new RiotApiClient(apiKey, credentialReporter, {
			fetch: options.fetch,
			sleep: options.sleep,
			now: options.now,
			temporaryState: options.temporaryState,
		});
		this.now = options.now ?? Date.now;
		this.pollIntervalSeconds =
			options.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
		this.players = options.players ?? [];
		this.setIntervalFn = options.setInterval ?? setInterval;
		this.clearIntervalFn = options.clearInterval ?? clearInterval;
		this.rankHistory = options.rankHistory;
		this.matches = options.matches;
		this.matchSync = options.matchSync;
		this.userLinks = options.userLinks;
		this.wol = options.wol;
	}

	isAvailable(): boolean {
		return this.client.isAvailable();
	}

	async clearCache(): Promise<void> {
		await this.client.clearCache();
		const deletes: Promise<void>[] = [];
		if (this.temporaryState) {
			for (const puuid of this.lolViewCache.keys()) {
				deletes.push(this.temporaryState.delete(lolViewRedisKey(puuid)));
			}
		}
		await Promise.all(deletes);
		this.lolViewCache.clear();
	}

	async getLolView(
		platform: RiotPlatform,
		puuid: string,
		fallbackNames?: { gameName: string; tagLine: string },
	): Promise<RiotLolView> {
		const cached = await this.readLolViewCache(puuid);
		if (cached) {
			return cached;
		}

		const region = platformToRegion(platform);
		const [account, entries, active, matchIds, summoner, history] =
			await Promise.all([
				this.client.getAccountByPuuid(region, puuid),
				this.client.getLeagueEntriesByPuuid(platform, puuid),
				this.client.getActiveGame(platform, puuid),
				this.client.getMatchIdsByPuuid(region, puuid, {
					count: RECENT_MATCH_COUNT,
				}),
				this.client.getSummonerByPuuid(platform, puuid),
				this.getRankHistory(puuid),
			]);

		const matches = (
			await Promise.all(matchIds.map((id) => this.client.getMatch(region, id)))
		).filter((m): m is RiotMatch => m !== null);

		const view: RiotLolView = {
			puuid,
			platform,
			gameName: account?.gameName ?? fallbackNames?.gameName ?? "Unknown",
			tagLine: account?.tagLine ?? fallbackNames?.tagLine ?? "???",
			entries,
			active,
			matches,
			summoner,
			history,
		};
		const entry: LolViewCacheEntry = {
			expiresAt: this.now() + LOL_VIEW_CACHE_TTL_MS,
			value: view,
		};
		this.lolViewCache.set(puuid, entry);
		if (this.temporaryState) {
			await this.temporaryState.set(
				lolViewRedisKey(puuid),
				entry,
				Math.max(1, Math.ceil((entry.expiresAt - this.now()) / 1000)),
			);
		}
		return view;
	}

	async getPollState(puuid: string): Promise<RiotPlayerPollState | null> {
		const local = this.snapshots.get(puuid);
		if (local) {
			return local;
		}
		if (!this.temporaryState) {
			return null;
		}
		const remote = await this.temporaryState.get<unknown>(
			snapshotRedisKey(puuid),
		);
		if (remote === null) {
			return null;
		}
		if (!isPlayerPollState(remote)) {
			await this.temporaryState.delete(snapshotRedisKey(puuid));
			return null;
		}
		this.snapshots.set(puuid, remote);
		return remote;
	}

	getAllPollStates(): RiotPlayerPollState[] {
		// keyed by resolved puuid after poll; insertion order matches last successful polls
		return [...this.snapshots.values()];
	}

	async getRankHistory(puuid: string): Promise<RiotRankHistoryEntry[]> {
		if (!this.rankHistory) {
			return [];
		}
		return this.rankHistory.listByPuuid(puuid);
	}

	startPoller(): void {
		if (
			!this.client.isAvailable() ||
			(this.players.length === 0 && !this.userLinks) ||
			this.pollTimer !== null
		) {
			return;
		}
		void this.pollOnce();
		this.pollTimer = this.setIntervalFn(() => {
			void this.pollOnce();
		}, this.pollIntervalSeconds * 1000);
	}

	stopPoller(): void {
		if (this.pollTimer !== null) {
			this.clearIntervalFn(this.pollTimer);
			this.pollTimer = null;
		}
	}

	async pollOnce(): Promise<void> {
		if (
			this.polling ||
			!this.client.isAvailable() ||
			(this.players.length === 0 && !this.userLinks)
		) {
			return;
		}
		this.polling = true;
		try {
			const syncPlayers = new Map<
				string,
				{ puuid: string; platform: RiotPlatform }
			>();
			for (const player of this.players) {
				const label = playerLabel(player);
				try {
					const state = await this.pollPlayer(player);
					this.snapshots.set(state.puuid, state);
					await this.persistSnapshot(state);
					this.emit("update", state);
					syncPlayers.set(state.puuid, {
						puuid: state.puuid,
						platform: player.platform,
					});
				} catch (error) {
					// ponytail: never emit("error") — unhandled crashes the process
					console.error(
						`Riot poll failed for ${label} (${player.platform}):`,
						error,
					);
				}
			}

			for (const link of (await this.userLinks?.listAll()) ?? []) {
				if (!syncPlayers.has(link.puuid)) {
					syncPlayers.set(link.puuid, {
						puuid: link.puuid,
						platform: link.platform,
					});
				}
			}
			for (const player of syncPlayers.values()) {
				try {
					await this.syncPlayerMatches(player);
				} catch (error) {
					console.error(
						`Riot match sync failed for ${player.puuid} (${player.platform}):`,
						error,
					);
				}
			}
		} finally {
			this.polling = false;
		}
	}

	async getAccountByRiotId(
		region: RiotRegion,
		gameName: string,
		tagLine: string,
	): Promise<RiotAccount | null> {
		return this.client.getAccountByRiotId(region, gameName, tagLine);
	}

	async getAccountByPuuid(
		region: RiotRegion,
		puuid: string,
	): Promise<RiotAccount | null> {
		return this.client.getAccountByPuuid(region, puuid);
	}

	async getMatchIdsByPuuid(
		region: RiotRegion,
		puuid: string,
		opts?: {
			start?: number;
			count?: number;
			startTime?: number;
			endTime?: number;
			queue?: number;
		},
	): Promise<string[]> {
		return this.client.getMatchIdsByPuuid(region, puuid, opts);
	}

	async getMatch(
		region: RiotRegion,
		matchId: string,
	): Promise<RiotMatch | null> {
		return this.client.getMatch(region, matchId);
	}

	async getLeagueEntriesByPuuid(
		platform: RiotPlatform,
		puuid: string,
	): Promise<RiotLeagueEntry[]> {
		return this.client.getLeagueEntriesByPuuid(platform, puuid);
	}

	async getActiveGame(
		platform: RiotPlatform,
		puuid: string,
	): Promise<RiotActiveGame | null> {
		return this.client.getActiveGame(platform, puuid);
	}

	async getSummonerByPuuid(
		platform: RiotPlatform,
		puuid: string,
	): Promise<RiotSummoner | null> {
		return this.client.getSummonerByPuuid(platform, puuid);
	}

	async request<T>(
		routing: RiotRegion | RiotPlatform,
		path: string,
		query?: Record<string, string | number | undefined>,
	): Promise<T> {
		return this.client.request(routing, path, query);
	}

	private async resolveAccount(
		player: RiotPlayerConfig,
	): Promise<RiotAccount | null> {
		const region = platformToRegion(player.platform);
		const parsed = parseRiotId(player.riotId);
		if (!parsed) {
			return null;
		}
		return this.client.getAccountByRiotId(
			region,
			parsed.gameName,
			parsed.tagLine,
		);
	}

	private async pollPlayer(
		player: RiotPlayerConfig,
	): Promise<RiotPlayerPollState> {
		const region = platformToRegion(player.platform);
		const account = await this.resolveAccount(player);
		if (!account) {
			throw new RiotGamesError(
				`Riot account not found for ${playerLabel(player)}`,
				404,
			);
		}
		const puuid = account.puuid;

		const memory = await this.loadPollMemory(puuid);

		if (!memory.seededFromDb && this.rankHistory) {
			const history = await this.rankHistory.listByPuuid(puuid);
			const newest = history[0];
			if (newest && memory.currentRank === null) {
				memory.currentRank = {
					tier: newest.tier,
					rank: newest.rank,
					leaguePoints: newest.leaguePoints,
					wins: newest.wins,
					losses: newest.losses,
				};
			}
			memory.seededFromDb = true;
		}

		const active = await this.client.getActiveGame(player.platform, puuid);
		let inProgress: RiotActiveGameStatus | null = null;
		if (active) {
			const self = active.participants.find((p) => p.puuid === puuid);
			inProgress = {
				gameId: active.gameId,
				gameStartTime: active.gameStartTime,
				gameLength: active.gameLength,
				gameMode: active.gameMode,
				queueId: active.gameQueueConfigId,
				championId: self?.championId ?? 0,
			};
		}

		const matchIds = await this.client.getMatchIdsByPuuid(region, puuid, {
			count: 1,
		});
		const newestMatchId = matchIds[0] ?? null;

		if (newestMatchId !== null && newestMatchId !== memory.lastMatchId) {
			const match = await this.client.getMatch(region, newestMatchId);
			const entries = await this.client.getLeagueEntriesByPuuid(
				player.platform,
				puuid,
			);
			const rankAfter = soloRankFromEntries(entries);
			const rankBefore = memory.currentRank;
			const participant = match?.info.participants.find(
				(p) => p.puuid === puuid,
			);
			if (match && participant) {
				memory.mostRecentEnded = {
					matchId: newestMatchId,
					kills: participant.kills,
					deaths: participant.deaths,
					assists: participant.assists,
					championId: participant.championId,
					win: participant.win,
					queueId: match.info.queueId,
					gameCreation: match.info.gameCreation,
					gameDuration: match.info.gameDuration,
					rankBefore,
					rankAfter,
				};
			}
			memory.lastMatchId = newestMatchId;
			memory.currentRank = rankAfter;
		} else {
			const entries = await this.client.getLeagueEntriesByPuuid(
				player.platform,
				puuid,
			);
			memory.currentRank = soloRankFromEntries(entries);
		}

		if (memory.currentRank && this.rankHistory) {
			await this.rankHistory.recordIfChanged(
				puuid,
				memory.currentRank,
				new Date(this.now()),
			);
		}

		this.pollMemory.set(puuid, memory);
		await this.persistPollMemory(puuid, memory);

		return {
			puuid,
			username: `${account.gameName}#${account.tagLine}`,
			gameName: account.gameName,
			tagLine: account.tagLine,
			platform: player.platform,
			currentRank: memory.currentRank,
			inProgress,
			mostRecentEnded: memory.mostRecentEnded,
		};
	}

	private async loadPollMemory(puuid: string): Promise<PlayerPollMemory> {
		const local = this.pollMemory.get(puuid);
		if (local) {
			return local;
		}
		if (this.temporaryState) {
			const remote = await this.temporaryState.get<unknown>(
				pollMemoryRedisKey(puuid),
			);
			if (remote !== null) {
				if (isPersistedPollMemory(remote)) {
					const memory: PlayerPollMemory = {
						lastMatchId: remote.lastMatchId,
						mostRecentEnded: remote.mostRecentEnded,
						currentRank: remote.currentRank,
						seededFromDb: false,
					};
					this.pollMemory.set(puuid, memory);
					return memory;
				}
				await this.temporaryState.delete(pollMemoryRedisKey(puuid));
			}
		}
		const memory: PlayerPollMemory = {
			lastMatchId: null,
			mostRecentEnded: null,
			currentRank: null,
			seededFromDb: false,
		};
		return memory;
	}

	private async persistPollMemory(
		puuid: string,
		memory: PlayerPollMemory,
	): Promise<void> {
		if (!this.temporaryState) {
			return;
		}
		const payload: PersistedPollMemory = {
			lastMatchId: memory.lastMatchId,
			mostRecentEnded: memory.mostRecentEnded,
			currentRank: memory.currentRank,
		};
		await this.temporaryState.set(pollMemoryRedisKey(puuid), payload);
	}

	private async persistSnapshot(state: RiotPlayerPollState): Promise<void> {
		if (!this.temporaryState) {
			return;
		}
		await this.temporaryState.set(snapshotRedisKey(state.puuid), state);
	}

	private async readLolViewCache(puuid: string): Promise<RiotLolView | null> {
		const local = this.lolViewCache.get(puuid);
		if (local) {
			if (local.expiresAt > this.now()) {
				return local.value;
			}
			this.lolViewCache.delete(puuid);
		}
		if (!this.temporaryState) {
			return null;
		}
		const redisKey = lolViewRedisKey(puuid);
		const remote = await this.temporaryState.get<unknown>(redisKey);
		if (remote === null) {
			return null;
		}
		if (
			typeof remote !== "object" ||
			remote === null ||
			typeof (remote as LolViewCacheEntry).expiresAt !== "number" ||
			!("value" in remote) ||
			(remote as LolViewCacheEntry).expiresAt <= this.now()
		) {
			await this.temporaryState.delete(redisKey);
			return null;
		}
		const entry = remote as LolViewCacheEntry;
		this.lolViewCache.set(puuid, entry);
		return entry.value;
	}

	private async listAllMatchIds(
		region: RiotRegion,
		puuid: string,
		opts: { queue?: number; startTime?: number; endTime?: number } = {},
	): Promise<string[]> {
		const all: string[] = [];
		let start = 0;
		for (;;) {
			const page = await this.client.getMatchIdsByPuuid(region, puuid, {
				start,
				count: MATCH_IDS_PAGE_SIZE,
				queue: opts.queue,
				startTime: opts.startTime,
				endTime: opts.endTime,
			});
			all.push(...page);
			if (page.length < MATCH_IDS_PAGE_SIZE) {
				break;
			}
			start += MATCH_IDS_PAGE_SIZE;
		}
		return all;
	}

	private async resolveRiotId(player: {
		platform: RiotPlatform;
		puuid?: string;
		riotId?: string;
	}): Promise<{ gameName: string; tagLine: string } | null> {
		if (player.riotId) {
			return parseRiotId(player.riotId);
		}
		const puuid = player.puuid;
		if (!puuid) {
			return null;
		}
		const link = await this.userLinks?.getByPuuid(puuid);
		if (link) {
			return { gameName: link.gameName, tagLine: link.tagLine };
		}
		const account = await this.client.getAccountByPuuid(
			platformToRegion(player.platform),
			puuid,
		);
		if (!account) {
			return null;
		}
		return { gameName: account.gameName, tagLine: account.tagLine };
	}

	/**
	 * One-shot wol.gg baseline when missing. No-op if already backfilled or scrape fails.
	 */
	async ensurePlaytimeBackfill(player: {
		puuid: string;
		platform: RiotPlatform;
		riotId?: string;
	}): Promise<void> {
		if (!this.matchSync || !this.wol) {
			return;
		}
		const row = await this.matchSync.get(player.puuid);
		if (row?.backfilled) {
			return;
		}
		const identity = await this.resolveRiotId(player);
		if (!identity) {
			return;
		}
		const backfillSeconds = await this.wol.fetchPlaytimeSeconds(
			player.platform,
			identity.gameName,
			identity.tagLine,
		);
		if (backfillSeconds === null) {
			// ponytail: retry later — do not lock 0 on a scrape miss
			return;
		}
		await this.matchSync.setBackfill(
			player.puuid,
			backfillSeconds,
			new Date(this.now()),
		);
	}

	private async syncPlayerMatches(player: {
		puuid: string;
		platform: RiotPlatform;
	}): Promise<void> {
		if (!this.matches || !this.matchSync || !this.wol) {
			return;
		}
		await this.ensurePlaytimeBackfill(player);
		const row = await this.matchSync.get(player.puuid);
		if (!row?.backfilled) {
			return;
		}

		const region = platformToRegion(player.platform);
		const now = new Date(this.now());
		const endTime = Math.floor(now.getTime() / 1000);
		const incrementalStartTime = Math.max(
			0,
			Math.floor(row.lastSyncedAt.getTime() / 1000) -
				MATCH_SYNC_OVERLAP_SECONDS,
		);
		const ids = await this.listAllMatchIds(region, player.puuid, {
			startTime: incrementalStartTime,
			endTime,
		});
		const known = await this.matches.existingMatchIds(ids);
		for (const matchId of ids) {
			if (known.has(matchId)) {
				continue;
			}
			const match = await this.client.getMatch(region, matchId);
			if (!match) {
				continue;
			}
			await this.matches.insertMatchWithParticipants(match);
		}
		await this.matchSync.touchSynced(player.puuid, now);
	}
}

function playerLabel(player: RiotPlayerConfig): string {
	return player.riotId;
}

function pollMemoryRedisKey(puuid: string): string {
	return `riot:pollMemory:${puuid}`;
}

function snapshotRedisKey(puuid: string): string {
	return `riot:snapshot:${puuid}`;
}

function lolViewRedisKey(puuid: string): string {
	return `riot:lolView:${puuid}`;
}

function isPersistedPollMemory(value: unknown): value is PersistedPollMemory {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const memory = value as PersistedPollMemory;
	return (
		(memory.lastMatchId === null || typeof memory.lastMatchId === "string") &&
		"mostRecentEnded" in memory &&
		"currentRank" in memory
	);
}

function isPlayerPollState(value: unknown): value is RiotPlayerPollState {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const state = value as RiotPlayerPollState;
	return (
		typeof state.puuid === "string" &&
		typeof state.username === "string" &&
		typeof state.gameName === "string" &&
		typeof state.tagLine === "string" &&
		typeof state.platform === "string"
	);
}
