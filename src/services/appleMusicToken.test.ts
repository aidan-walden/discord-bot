import { describe, expect, test } from "bun:test";
import { startAppleMusicTokenScrape } from "./appleMusicToken";

const BROWSE_URL = "https://music.apple.com/us/browse";

function buildJwt(exp: number): string {
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp })}.sig`;
}

function response(body: string): Response {
	return new Response(body, { status: 200 });
}

describe("startAppleMusicTokenScrape", () => {
	test("finds a valid token in a JavaScript asset", async () => {
		const token = buildJwt(Math.floor(Date.now() / 1000) + 3600);
		const requestedUrls: string[] = [];
		const fetcher = (async (input: string | Request | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return url === BROWSE_URL
				? response('<script src="/assets/index-abc.js"></script>')
				: response(`window.token = "${token}";`);
		}) as typeof fetch;

		expect(await startAppleMusicTokenScrape(fetcher).token).toBe(token);
		expect(requestedUrls).toEqual([
			BROWSE_URL,
			"https://music.apple.com/assets/index-abc.js",
		]);
	});

	test("skips expired tokens and uses a later valid token", async () => {
		const expiredToken = buildJwt(Math.floor(Date.now() / 1000) - 1);
		const validToken = buildJwt(Math.floor(Date.now() / 1000) + 3600);
		const fetcher = (async (input: string | Request | URL) => {
			const url = String(input);
			if (url === BROWSE_URL) {
				return response(
					[
						'<script src="/assets/expired.js"></script>',
						'<script src="/assets/valid.js"></script>',
					].join(""),
				);
			}
			return url.endsWith("expired.js")
				? response(`const token = "${expiredToken}";`)
				: response(`const token = "${validToken}";`);
		}) as typeof fetch;

		expect(await startAppleMusicTokenScrape(fetcher).token).toBe(validToken);
	});

	test("throws when no JWT is present", async () => {
		const fetcher = (async (input: string | Request | URL) =>
			String(input) === BROWSE_URL
				? response('<script src="/assets/index.js"></script>')
				: response("const app = true;")) as typeof fetch;

		await expect(startAppleMusicTokenScrape(fetcher).token).rejects.toThrow(
			"Unable to find a valid Apple Music developer token",
		);
	});

	test("resolves relative JavaScript asset URLs against music.apple.com", async () => {
		const token = buildJwt(Math.floor(Date.now() / 1000) + 3600);
		const requestedUrls: string[] = [];
		const fetcher = (async (input: string | Request | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			return url === BROWSE_URL
				? response('<link rel="modulepreload" href="assets/index.js">')
				: response(token);
		}) as typeof fetch;

		expect(await startAppleMusicTokenScrape(fetcher).token).toBe(token);
		expect(requestedUrls[1]).toBe("https://music.apple.com/assets/index.js");
	});

	test("fetches the index entry bundle before other assets", async () => {
		const token = buildJwt(Math.floor(Date.now() / 1000) + 3600);
		const requestedUrls: string[] = [];
		const fetcher = (async (input: string | Request | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			if (url === BROWSE_URL) {
				return response(
					[
						'<script src="/assets/vendor.js"></script>',
						'<script src="/assets/index-abc.js"></script>',
					].join(""),
				);
			}
			return url.endsWith("index-abc.js") ? response(token) : response("");
		}) as typeof fetch;

		expect(await startAppleMusicTokenScrape(fetcher).token).toBe(token);
		expect(requestedUrls).toEqual([
			BROWSE_URL,
			"https://music.apple.com/assets/index-abc.js",
		]);
	});

	test("settles the foreground after the asset limit and keeps searching in the background", async () => {
		const token = buildJwt(Math.floor(Date.now() / 1000) + 3600);
		const requestedUrls: string[] = [];
		const assets = Array.from(
			{ length: 12 },
			(_, index) => `<script src="/assets/chunk-${index}.js"></script>`,
		).join("");
		let releaseBackground: () => void = () => {};
		const backgroundGate = new Promise<void>((resolve) => {
			releaseBackground = resolve;
		});
		const fetcher = (async (input: string | Request | URL) => {
			const url = String(input);
			requestedUrls.push(url);
			if (url === BROWSE_URL) {
				return response(assets);
			}
			if (url.endsWith("chunk-3.js")) {
				await backgroundGate;
			}
			return url.endsWith("chunk-10.js") ? response(token) : response("");
		}) as typeof fetch;

		const scrape = startAppleMusicTokenScrape(fetcher, {
			foregroundAssetLimit: 3,
		});
		await scrape.foreground;
		// The foreground settles once the first 3 assets are checked; the 4th is
		// already in flight in the background.
		expect(requestedUrls).toEqual([
			BROWSE_URL,
			"https://music.apple.com/assets/chunk-0.js",
			"https://music.apple.com/assets/chunk-1.js",
			"https://music.apple.com/assets/chunk-2.js",
			"https://music.apple.com/assets/chunk-3.js",
		]);

		releaseBackground();
		expect(await scrape.token).toBe(token);
		expect(requestedUrls).toHaveLength(12);
	});

	test("settles the foreground at the deadline while the scrape continues", async () => {
		const token = buildJwt(Math.floor(Date.now() / 1000) + 3600);
		let releaseAsset: () => void = () => {};
		const assetGate = new Promise<void>((resolve) => {
			releaseAsset = resolve;
		});
		const fetcher = (async (input: string | Request | URL) => {
			if (String(input) === BROWSE_URL) {
				return response('<script src="/assets/index.js"></script>');
			}
			await assetGate;
			return response(token);
		}) as typeof fetch;

		const scrape = startAppleMusicTokenScrape(fetcher, {
			foregroundDeadlineMs: 10,
		});
		await scrape.foreground;

		releaseAsset();
		expect(await scrape.token).toBe(token);
	});
});
