const APPLE_MUSIC_BROWSE_URL = "https://music.apple.com/us/browse";
const APPLE_MUSIC_BASE_URL = "https://music.apple.com";
const TOKEN_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const TOKEN_FETCH_TIMEOUT_MS = 10_000;
/** Overall budget for the whole scrape, across the browse page and all assets. */
const TOKEN_SCRAPE_DEADLINE_MS = 30_000;
/** Upper bound on JavaScript assets fetched while searching for the token. */
const MAX_ASSET_REQUESTS = 8;
const BROWSER_USER_AGENT =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function decodeAppleMusicJwtPayload(
	token: string,
): Record<string, unknown> | null {
	const segments = token.split(".");
	if (
		segments.length !== 3 ||
		segments.some((segment) => !isBase64UrlSegment(segment))
	) {
		return null;
	}

	const payloadSegment = segments[1];
	if (!isBase64UrlSegment(payloadSegment)) {
		return null;
	}

	const payload = decodeBase64Url(payloadSegment);
	if (payload === null) {
		return null;
	}

	try {
		const decoded = JSON.parse(payload) as unknown;
		return isRecord(decoded) ? decoded : null;
	} catch {
		return null;
	}
}

export function isValidAppleMusicDeveloperToken(token: string): boolean {
	const payload = decodeAppleMusicJwtPayload(token);
	const expiresAt = payload?.exp;
	return (
		typeof expiresAt === "number" &&
		Number.isFinite(expiresAt) &&
		expiresAt > Date.now() / 1000
	);
}

export interface AppleMusicTokenScrapeOptions {
	/** Overall time budget for the scrape in milliseconds. */
	deadlineMs?: number;
	/** Maximum number of JavaScript assets to fetch. */
	maxAssetRequests?: number;
}

export async function scrapeAppleMusicDeveloperToken(
	fetcher?: typeof fetch,
	options: AppleMusicTokenScrapeOptions = {},
): Promise<string> {
	const request = fetcher ?? fetch;
	const deadline = AbortSignal.timeout(
		options.deadlineMs ?? TOKEN_SCRAPE_DEADLINE_MS,
	);
	const maxAssetRequests = options.maxAssetRequests ?? MAX_ASSET_REQUESTS;

	const html = await fetchText(request, APPLE_MUSIC_BROWSE_URL, deadline);
	if (html === null) {
		throw new Error("Failed to fetch the Apple Music browse page.");
	}

	const htmlToken = findValidToken(html);
	if (htmlToken) {
		return htmlToken;
	}

	const assetUrls = prioritizeAssetUrls(collectJavaScriptAssetUrls(html)).slice(
		0,
		maxAssetRequests,
	);
	for (const assetUrl of assetUrls) {
		if (deadline.aborted) {
			throw new Error(
				"Timed out searching the music.apple.com web bundle for an Apple Music developer token.",
			);
		}

		const javascript = await fetchText(request, assetUrl, deadline);
		if (javascript === null) {
			continue;
		}

		const assetToken = findValidToken(javascript);
		if (assetToken) {
			return assetToken;
		}
	}

	throw new Error(
		"Unable to find a valid Apple Music developer token in the music.apple.com web bundle.",
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64UrlSegment(value: string | undefined): value is string {
	return (
		value !== undefined && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value)
	);
}

function decodeBase64Url(value: string): string | null {
	if (!isBase64UrlSegment(value)) {
		return null;
	}

	const base64 = value
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");

	try {
		const binary = globalThis.atob(base64);
		const bytes = Uint8Array.from(binary, (character) =>
			character.charCodeAt(0),
		);
		return new TextDecoder().decode(bytes);
	} catch {
		return null;
	}
}

function findValidToken(text: string): string | null {
	for (const match of text.matchAll(TOKEN_PATTERN)) {
		const candidate = match[0];
		if (candidate && isValidAppleMusicDeveloperToken(candidate)) {
			return candidate;
		}
	}
	return null;
}

function collectJavaScriptAssetUrls(html: string): string[] {
	const urls = new Set<string>();
	const tagPattern = /<(?:script|link)\b[^>]*>/gi;
	const attributePattern =
		/\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

	for (const match of html.matchAll(tagPattern)) {
		const tag = match[0];
		if (!tag) {
			continue;
		}

		const attribute = attributePattern.exec(tag);
		const rawUrl = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3];
		if (!rawUrl) {
			continue;
		}

		try {
			const url = new URL(rawUrl, APPLE_MUSIC_BASE_URL);
			if (url.pathname.toLowerCase().endsWith(".js")) {
				urls.add(url.href);
			}
		} catch {
			// Ignore malformed asset references and continue with other bundles.
		}
	}

	return [...urls];
}

/**
 * The developer token lives in the main `index-*.js` entry bundle, so try
 * those first; the remaining assets keep their document order.
 */
function prioritizeAssetUrls(urls: string[]): string[] {
	const isEntryBundle = (url: string) =>
		/\/index[^/]*\.js$/i.test(new URL(url).pathname);
	return [
		...urls.filter(isEntryBundle),
		...urls.filter((url) => !isEntryBundle(url)),
	];
}

async function fetchText(
	fetcher: typeof fetch,
	url: string,
	deadline: AbortSignal,
): Promise<string | null> {
	try {
		const response = await fetcher(url, {
			method: "GET",
			headers: { "User-Agent": BROWSER_USER_AGENT },
			signal: AbortSignal.any([
				deadline,
				AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
			]),
		});
		if (response.ok === false) {
			return null;
		}
		return await response.text();
	} catch {
		return null;
	}
}
