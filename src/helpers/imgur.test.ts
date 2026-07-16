import { afterEach, describe, expect, mock, test } from "bun:test";
import { clearImgurAlbumCache, getAlbumImageLinks, ImgurError } from "./imgur";

afterEach(() => {
	clearImgurAlbumCache();
});

describe("getAlbumImageLinks", () => {
	test("returns image links from album payload", async () => {
		const fetcher = mock(async () =>
			Response.json({
				data: {
					images: [
						{ link: "https://i.imgur.com/a.png" },
						{ link: "https://i.imgur.com/b.png" },
					],
				},
			}),
		);

		const links = await getAlbumImageLinks("client-id", "album", fetcher);
		expect(links).toEqual([
			"https://i.imgur.com/a.png",
			"https://i.imgur.com/b.png",
		]);
		expect(fetcher).toHaveBeenCalledWith(
			"https://api.imgur.com/3/album/album",
			{
				headers: { Authorization: "Client-ID client-id" },
			},
		);
	});

	test("caches album links and skips later fetches", async () => {
		const fetcher = mock(async () =>
			Response.json({
				data: {
					images: [{ link: "https://i.imgur.com/a.png" }],
				},
			}),
		);

		const first = await getAlbumImageLinks("client-id", "cached", fetcher);
		const second = await getAlbumImageLinks("client-id", "cached", fetcher);

		expect(first).toEqual(["https://i.imgur.com/a.png"]);
		expect(second).toEqual(first);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("throws when album is empty", async () => {
		const fetcher = mock(async () => Response.json({ data: { images: [] } }));

		await expect(
			getAlbumImageLinks("id", "album", fetcher),
		).rejects.toBeInstanceOf(ImgurError);
	});
});
