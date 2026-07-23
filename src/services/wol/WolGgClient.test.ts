import { describe, expect, mock, test } from "bun:test";
import WolGgClient, {
	PLATFORM_TO_WOL_REGION,
	parseWolMinutes,
	wolSlug,
} from "./WolGgClient";

const SAMPLE_HTML = `
<div id="card-stats">
  <div id="times">
    <div id="time-minutes" class="time center"><p>63,266<br><b>minutes</b></p></div>
    <div id="time-hours" class="time center"><p>1,054<br><b>hours</b></p></div>
  </div>
</div>
`;

const ERROR_HTML = `
<html><body>
  <h1>An error has occured.</h1>
  <li>The informed player does not exist or has changed his nickname.</li>
</body></html>
`;

describe("WolGgClient helpers", () => {
	test("wolSlug lowercases and strips spaces", () => {
		expect(wolSlug("Irl Landmine", "09345")).toBe("irllandmine-09345");
	});

	test("platform maps to wol region", () => {
		expect(PLATFORM_TO_WOL_REGION.na1).toBe("na");
		expect(PLATFORM_TO_WOL_REGION.eun1).toBe("eune");
		expect(PLATFORM_TO_WOL_REGION.la1).toBe("lan");
	});

	test("parseWolMinutes reads comma-separated minutes", () => {
		expect(parseWolMinutes(SAMPLE_HTML)).toBe(63_266);
	});

	test("parseWolMinutes returns null on error page", () => {
		expect(parseWolMinutes(ERROR_HTML)).toBeNull();
	});
});

describe("WolGgClient.fetchPlaytimeSeconds", () => {
	test("returns minutes * 60 from HTML", async () => {
		const fetcher = mock(async (url: string | URL | Request) => {
			expect(String(url)).toBe("https://wol.gg/stats/na/irllandmine-09345/");
			return new Response(SAMPLE_HTML, { status: 200 });
		});
		const client = new WolGgClient({ fetch: fetcher });
		expect(
			await client.fetchPlaytimeSeconds("na1", "Irl Landmine", "09345"),
		).toBe(63_266 * 60);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("returns null when player missing", async () => {
		const client = new WolGgClient({
			fetch: mock(async () => new Response(ERROR_HTML, { status: 200 })),
		});
		expect(await client.fetchPlaytimeSeconds("na1", "Nope", "TAG")).toBeNull();
	});

	test("caches successful lookups", async () => {
		const fetcher = mock(
			async () => new Response(SAMPLE_HTML, { status: 200 }),
		);
		let now = 1_000;
		const client = new WolGgClient({ fetch: fetcher, now: () => now });
		await client.fetchPlaytimeSeconds("na1", "A", "B");
		now += 1_000;
		await client.fetchPlaytimeSeconds("na1", "A", "B");
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
