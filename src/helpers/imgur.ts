const albumCache = new Map<string, string[]>();

type Fetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

interface ImgurAlbumResponse {
	data?: {
		images?: Array<{ link?: string }>;
	};
}

export class ImgurError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ImgurError";
	}
}

export async function getAlbumImageLinks(
	clientId: string,
	albumId: string,
	fetcher: Fetcher = fetch,
): Promise<string[]> {
	const cached = albumCache.get(albumId);
	if (cached) {
		return cached;
	}

	const response = await fetcher(`https://api.imgur.com/3/album/${albumId}`, {
		headers: { Authorization: `Client-ID ${clientId}` },
	});
	if (!response.ok) {
		throw new ImgurError(`Imgur returned HTTP ${response.status}`);
	}

	const payload = (await response.json()) as ImgurAlbumResponse;
	const links = payload.data?.images
		?.map((image) => image.link)
		.filter((link): link is string => Boolean(link));
	if (!links?.length) {
		throw new ImgurError("Imgur album contains no images");
	}

	albumCache.set(albumId, links);
	return links;
}

export function clearImgurAlbumCache(): void {
	albumCache.clear();
}
