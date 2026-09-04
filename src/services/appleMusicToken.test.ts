import { describe, expect, test } from "bun:test";
import { scrapeAppleMusicDeveloperToken } from "./appleMusicToken";

const BROWSE_URL = "https://music.apple.com/us/browse";

function buildJwt(exp: number): string {
	const encode = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none", typ: "JWT" })}.${encode({ exp })}.sig`;
}

function response(body: string): Response {
	return new Response(body, { status: 200 });
}

describe("scrapeAppleMusicDeveloperToken", () => {
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

		expect(await scrapeAppleMusicDeveloperToken(fetcher)).toBe(token);
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

		expect(await scrapeAppleMusicDeveloperToken(fetcher)).toBe(validToken);
	});

	test("throws when no JWT is present", async () => {
		const fetcher = (async (input: string | Request | URL) =>
			String(input) === BROWSE_URL
				? response('<script src="/assets/index.js"></script>')
				: response("const app = true;")) as typeof fetch;

		await expect(scrapeAppleMusicDeveloperToken(fetcher)).rejects.toThrow(
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

		expect(await scrapeAppleMusicDeveloperToken(fetcher)).toBe(token);
		expect(requestedUrls[1]).toBe("https://music.apple.com/assets/index.js");
	});
});
