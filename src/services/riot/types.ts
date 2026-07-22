import type { RiotPlatform } from "./constants";

export type { RiotPlatform, RiotRegion } from "./constants";

export interface RiotPlayerConfig {
	puuid: string;
	platform: RiotPlatform;
}

export interface RiotAccount {
	puuid: string;
	gameName: string;
	tagLine: string;
}

export interface RiotMatchParticipant {
	puuid: string;
	championId: number;
	champLevel: number;
	kills: number;
	deaths: number;
	assists: number;
	win: boolean;
	teamId: number;
	totalMinionsKilled: number;
	visionScore: number;
	goldEarned: number;
	item0: number;
	item1: number;
	item2: number;
	item3: number;
	item4: number;
	item5: number;
	item6: number;
}

export interface RiotMatch {
	metadata: {
		matchId: string;
		participants: string[];
	};
	info: {
		gameCreation: number;
		gameDuration: number;
		queueId: number;
		participants: RiotMatchParticipant[];
	};
}

export interface RiotLeagueEntry {
	queueType: string;
	tier: string;
	rank: string;
	leaguePoints: number;
	wins: number;
	losses: number;
}

export interface RiotActiveGame {
	gameId: number;
	gameStartTime: number;
	gameLength: number;
	gameMode: string;
	gameQueueConfigId: number;
	participants: Array<{
		puuid: string;
		championId: number;
	}>;
}

export interface RiotRank {
	tier: string;
	rank: string;
	leaguePoints: number;
	wins: number;
	losses: number;
}

export interface RiotActiveGameStatus {
	gameId: number;
	gameStartTime: number;
	gameLength: number;
	gameMode: string;
	queueId: number;
	championId: number;
}

export interface RiotEndedGameStats {
	matchId: string;
	kills: number;
	deaths: number;
	assists: number;
	championId: number;
	win: boolean;
	queueId: number;
	gameCreation: number;
	gameDuration: number;
	rankBefore: RiotRank | null;
	rankAfter: RiotRank | null;
}

export interface RiotPlayerPollState {
	puuid: string;
	username: string;
	gameName: string;
	tagLine: string;
	platform: RiotPlatform;
	currentRank: RiotRank | null;
	inProgress: RiotActiveGameStatus | null;
	mostRecentEnded: RiotEndedGameStats | null;
}

export interface RiotRankHistoryEntry {
	puuid: string;
	tier: string;
	rank: string;
	leaguePoints: number;
	wins: number;
	losses: number;
	detectedAt: Date;
}

export class RiotGamesError extends Error {
	readonly status: number;
	readonly retryAfterMs?: number;

	constructor(message: string, status: number, retryAfterMs?: number) {
		super(message);
		this.name = "RiotGamesError";
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}

export type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface RiotApiClientOptions {
	fetch?: Fetcher;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}
