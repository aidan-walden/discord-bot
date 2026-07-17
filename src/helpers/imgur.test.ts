import { afterEach, describe, expect, mock, test } from "bun:test";
import { clearImgurAlbumCache, getAlbumImageLinks, ImgurError } from "./imgur";

const credentialReporter = { recordCredentialRejection: mock(() => undefined) };

afterEach(() => {
	clearImgurAlbumCache();
	credentialReporter.recordCredentialRejection.mockClear();
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

		const links = await getAlbumImageLinks(
			"client-id",
			"album",
			credentialReporter,
			fetcher,
		);
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

		const first = await getAlbumImageLinks(
			"client-id",
			"cached",
			credentialReporter,
			fetcher,
		);
		const second = await getAlbumImageLinks(
			"client-id",
			"cached",
			credentialReporter,
			fetcher,
		);

		expect(first).toEqual(["https://i.imgur.com/a.png"]);
		expect(second).toEqual(first);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("throws when album is empty", async () => {
		const fetcher = mock(async () => Response.json({ data: { images: [] } }));

		expect(
			getAlbumImageLinks("id", "album", credentialReporter, fetcher),
		).rejects.toBeInstanceOf(ImgurError);
	});

	test("reports rejected Imgur credentials", async () => {
		const fetcher = mock(async () => new Response(null, { status: 403 }));
		const recordCredentialRejection = mock(() => undefined);

		expect(
			getAlbumImageLinks(
				"bad-id",
				"album",
				{ recordCredentialRejection },
				fetcher,
			),
		).rejects.toBeInstanceOf(ImgurError);

		expect(recordCredentialRejection).toHaveBeenCalledWith("imgur");
	});

	test("does not report unrelated Imgur failures as credential rejection", async () => {
		const fetcher = mock(async () => new Response(null, { status: 429 }));
		const recordCredentialRejection = mock(() => undefined);

		expect(
			getAlbumImageLinks("id", "album", { recordCredentialRejection }, fetcher),
		).rejects.toBeInstanceOf(ImgurError);

		expect(recordCredentialRejection).not.toHaveBeenCalled();
	});
});
