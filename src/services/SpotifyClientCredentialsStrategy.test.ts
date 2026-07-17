import { describe, expect, mock, test } from "bun:test";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import SpotifyClientCredentialsStrategy from "./SpotifyClientCredentialsStrategy";

function createApi(status: number) {
	const recordCredentialRejection = mock(() => undefined);
	const fetcher = mock(async () => new Response(null, { status }));
	const strategy = new SpotifyClientCredentialsStrategy(
		"client-id",
		"client-secret",
		{ recordCredentialRejection },
	);
	const api = new SpotifyApi(strategy, { fetch: fetcher });
	return { api, fetcher, recordCredentialRejection };
}

describe("SpotifyClientCredentialsStrategy", () => {
	test("reports rejected client credentials", async () => {
		const { api, fetcher, recordCredentialRejection } = createApi(401);

		expect(api.authenticate()).rejects.toThrow(
			"Failed to get Spotify access token.",
		);

		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(recordCredentialRejection).toHaveBeenCalledWith("spotify");
	});

	test("does not report an upstream Spotify failure as credential rejection", async () => {
		const { api, recordCredentialRejection } = createApi(500);

		expect(api.authenticate()).rejects.toThrow(
			"Failed to get Spotify access token.",
		);

		expect(recordCredentialRejection).not.toHaveBeenCalled();
	});
});
