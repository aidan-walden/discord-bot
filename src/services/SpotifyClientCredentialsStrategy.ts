import type {
	AccessToken,
	IAuthStrategy,
	SdkConfiguration,
} from "@spotify/web-api-ts-sdk";
import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const CACHE_KEY = "discord-bot:spotify-client-credentials-token";

export default class SpotifyClientCredentialsStrategy implements IAuthStrategy {
	private configuration: SdkConfiguration | null = null;

	constructor(
		private readonly clientId: string,
		private readonly clientSecret: string,
		private readonly credentialReporter: CredentialRejectionReporter,
	) {}

	setConfiguration(configuration: SdkConfiguration): void {
		this.configuration = configuration;
	}

	async getOrCreateAccessToken(): Promise<AccessToken> {
		const configuration = this.getConfiguration();
		return configuration.cachingStrategy.getOrCreate(
			CACHE_KEY,
			() => this.requestAccessToken(),
			() => this.requestAccessToken(),
		);
	}

	async getAccessToken(): Promise<AccessToken | null> {
		return this.getConfiguration().cachingStrategy.get<AccessToken>(CACHE_KEY);
	}

	removeAccessToken(): void {
		this.getConfiguration().cachingStrategy.remove(CACHE_KEY);
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
