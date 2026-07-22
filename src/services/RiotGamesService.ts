import { EventEmitter } from "node:events";
import type RiotRankHistoryRepository from "../repositories/RiotRankHistoryRepository";
import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";
import {
	DEFAULT_POLL_INTERVAL_SECONDS,
	platformToRegion,
	SOLO_QUEUE,
} from "./riot/constants";
import RiotApiClient from "./riot/RiotApiClient";
import type {
	Fetcher,
	RiotAccount,
	RiotActiveGame,
	RiotActiveGameStatus,
	RiotEndedGameStats,
	RiotLeagueEntry,
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

export {
	FLEX_QUEUE,
	FRIENDLY_REGION_TO_PLATFORM,
	parseFriendlyRegion,
	platformToRegion,
	profileIconUrl,
	queueName,
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
}

type RiotGamesServiceEvents = {
	update: [state: RiotPlayerPollState];
	error: [error: unknown, player: RiotPlayerConfig];
};

interface PlayerPollMemory {
	lastMatchId: string | null;
	mostRecentEnded: RiotEndedGameStats | null;
	currentRank: RiotRank | null;
	seededFromDb: boolean;
}

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
	private readonly now: () => number;
	private readonly pollMemory = new Map<string, PlayerPollMemory>();
	private readonly snapshots = new Map<string, RiotPlayerPollState>();
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private polling = false;

	constructor(
		apiKey: string | null,
		credentialReporter?: CredentialRejectionReporter,
		options: RiotGamesServiceOptions = {},
	) {
		super();
		this.client = new RiotApiClient(apiKey, credentialReporter, {
			fetch: options.fetch,
			sleep: options.sleep,
			now: options.now,
		});
		this.now = options.now ?? Date.now;
		this.pollIntervalSeconds =
			options.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS;
		this.players = options.players ?? [];
		this.setIntervalFn = options.setInterval ?? setInterval;
		this.clearIntervalFn = options.clearInterval ?? clearInterval;
		this.rankHistory = options.rankHistory;
	}

	isAvailable(): boolean {
		return this.client.isAvailable();
	}

	clearCache(): void {
		this.client.clearCache();
	}

	getPollState(puuid: string): RiotPlayerPollState | null {
		return this.snapshots.get(puuid) ?? null;
	}

	getAllPollStates(): RiotPlayerPollState[] {
		return this.players
			.map((player) => this.snapshots.get(player.puuid))
			.filter((state): state is RiotPlayerPollState => state !== undefined);
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
			this.players.length === 0 ||
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
			this.players.length === 0
		) {
			return;
		}
		this.polling = true;
		try {
			for (const player of this.players) {
				try {
					const state = await this.pollPlayer(player);
					this.snapshots.set(player.puuid, state);
					this.emit("update", state);
				} catch (error) {
					this.emit("error", error, player);
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
		opts?: { start?: number; count?: number },
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

	private async pollPlayer(
		player: RiotPlayerConfig,
	): Promise<RiotPlayerPollState> {
		const region = platformToRegion(player.platform);
		let memory = this.pollMemory.get(player.puuid);
		if (!memory) {
			memory = {
				lastMatchId: null,
				mostRecentEnded: null,
				currentRank: null,
				seededFromDb: false,
			};
		}

		if (!memory.seededFromDb && this.rankHistory) {
			const history = await this.rankHistory.listByPuuid(player.puuid);
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

		const account = await this.client.getAccountByPuuid(region, player.puuid);
		if (!account) {
			throw new RiotGamesError(
				`Riot account not found for puuid ${player.puuid}`,
				404,
			);
		}

		const active = await this.client.getActiveGame(
			player.platform,
			player.puuid,
		);
		let inProgress: RiotActiveGameStatus | null = null;
		if (active) {
			const self = active.participants.find((p) => p.puuid === player.puuid);
			inProgress = {
				gameId: active.gameId,
				gameStartTime: active.gameStartTime,
				gameLength: active.gameLength,
				gameMode: active.gameMode,
				queueId: active.gameQueueConfigId,
				championId: self?.championId ?? 0,
			};
		}

		const matchIds = await this.client.getMatchIdsByPuuid(
			region,
			player.puuid,
			{ count: 1 },
		);
		const newestMatchId = matchIds[0] ?? null;

		if (newestMatchId !== null && newestMatchId !== memory.lastMatchId) {
			const match = await this.client.getMatch(region, newestMatchId);
			const entries = await this.client.getLeagueEntriesByPuuid(
				player.platform,
				player.puuid,
			);
			const rankAfter = soloRankFromEntries(entries);
			const rankBefore = memory.currentRank;
			const participant = match?.info.participants.find(
				(p) => p.puuid === player.puuid,
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
				player.puuid,
			);
			memory.currentRank = soloRankFromEntries(entries);
		}

		if (memory.currentRank && this.rankHistory) {
			await this.rankHistory.recordIfChanged(
				player.puuid,
				memory.currentRank,
				new Date(this.now()),
			);
		}

		this.pollMemory.set(player.puuid, memory);

		return {
			puuid: player.puuid,
			username: `${account.gameName}#${account.tagLine}`,
			gameName: account.gameName,
			tagLine: account.tagLine,
			platform: player.platform,
			currentRank: memory.currentRank,
			inProgress,
			mostRecentEnded: memory.mostRecentEnded,
		};
	}
}
