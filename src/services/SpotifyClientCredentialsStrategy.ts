import type {
	AccessToken,
	IAuthStrategy,
	SdkConfiguration,
} from "@spotify/web-api-ts-sdk";
import type { TemporaryStateRepository } from "../repositories/TemporaryStateRepository";
import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SDK_CACHE_KEY = "discord-bot:spotify-client-credentials-token";
const REDIS_KEY = "spotify:client-credentials-token";

type TemporaryState = Pick<TemporaryStateRepository, "get" | "set" | "delete">;

function isValidAccessToken(value: unknown, now: number): value is AccessToken {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const token = value as AccessToken;
	return (
		typeof token.access_token === "string" &&
		token.access_token.length > 0 &&
		typeof token.expires === "number" &&
		Number.isFinite(token.expires) &&
		token.expires > now
	);
}

export default class SpotifyClientCredentialsStrategy implements IAuthStrategy {
	private configuration: SdkConfiguration | null = null;
	/** removeAccessToken is sync; await in-flight Redis delete on next async token read. */
	private pendingRedisDelete: Promise<void> | null = null;

	constructor(
		private readonly clientId: string,
		private readonly clientSecret: string,
		private readonly credentialReporter: CredentialRejectionReporter,
		private readonly temporaryState: TemporaryState,
	) {}

	setConfiguration(configuration: SdkConfiguration): void {
		this.configuration = configuration;
	}

	async getOrCreateAccessToken(): Promise<AccessToken> {
		await this.flushPendingRedisDelete();
		const configuration = this.getConfiguration();
		const existing =
			await configuration.cachingStrategy.get<AccessToken>(SDK_CACHE_KEY);
		const now = Date.now();
		if (isValidAccessToken(existing, now)) {
			return existing;
		}

		const restored = await this.loadFromRedis(now);
		if (restored) {
			configuration.cachingStrategy.setCacheItem(SDK_CACHE_KEY, restored);
			return restored;
		}

		return configuration.cachingStrategy.getOrCreate(
			SDK_CACHE_KEY,
			() => this.requestAndStoreAccessToken(),
			() => this.requestAndStoreAccessToken(),
		);
	}

	async getAccessToken(): Promise<AccessToken | null> {
		await this.flushPendingRedisDelete();
		const configuration = this.getConfiguration();
		const existing =
			await configuration.cachingStrategy.get<AccessToken>(SDK_CACHE_KEY);
		const now = Date.now();
		if (isValidAccessToken(existing, now)) {
			return existing;
		}

		const restored = await this.loadFromRedis(now);
		if (restored) {
			configuration.cachingStrategy.setCacheItem(SDK_CACHE_KEY, restored);
			return restored;
		}
		return null;
	}

	removeAccessToken(): void {
		this.getConfiguration().cachingStrategy.remove(SDK_CACHE_KEY);
		const deletion = this.temporaryState
			.delete(REDIS_KEY)
			.catch(() => undefined);
		this.pendingRedisDelete = this.pendingRedisDelete
			? this.pendingRedisDelete.then(() => deletion)
			: deletion;
	}

	private async requestAndStoreAccessToken(): Promise<AccessToken> {
		const token = await this.requestAccessToken();
		await this.storeInRedis(token);
		return token;
	}

	private async loadFromRedis(now: number): Promise<AccessToken | null> {
		const raw = await this.temporaryState.get<unknown>(REDIS_KEY);
		if (raw === null) {
			return null;
		}
		if (!isValidAccessToken(raw, now)) {
			await this.temporaryState.delete(REDIS_KEY);
			return null;
		}
		return raw;
	}

	private async storeInRedis(token: AccessToken): Promise<void> {
		const expires = token.expires;
		if (typeof expires !== "number" || !Number.isFinite(expires)) {
			return;
		}
		const ttlSeconds = Math.max(1, Math.ceil((expires - Date.now()) / 1000));
		await this.temporaryState.set(REDIS_KEY, token, ttlSeconds);
	}

	private async flushPendingRedisDelete(): Promise<void> {
		if (!this.pendingRedisDelete) {
			return;
		}
		await this.pendingRedisDelete;
		this.pendingRedisDelete = null;
	}

	private async requestAccessToken(): Promise<AccessToken> {
		const credentials = Buffer.from(
			`${this.clientId}:${this.clientSecret}`,
		).toString("base64");
		const response = await this.getConfiguration().fetch(TOKEN_URL, {
			method: "POST",
			headers: {
				Authorization: `Basic ${credentials}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: "grant_type=client_credentials",
		});

		if ([400, 401, 403].includes(response.status)) {
			this.credentialReporter.recordCredentialRejection("spotify");
		}
		if (response.status !== 200) {
			throw new Error("Failed to get Spotify access token.");
		}

		const token = (await response.json()) as AccessToken;
		return {
			...token,
			expires: Date.now() + token.expires_in * 1000,
		};
	}

	private getConfiguration(): SdkConfiguration {
		if (!this.configuration) {
			throw new Error("Spotify authentication strategy is not configured.");
		}
		return this.configuration;
	}
}
