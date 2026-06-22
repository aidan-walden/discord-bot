const IMAGE_URL_PATH_PATTERN = /\.(?:png|jpe?g|gif|webp|avif)$/i;
const VALID_IMAGE_MIME_TYPES = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/avif",
]);

type ProfilePictureFetch = (
	input: string,
	init?: RequestInit,
) => Promise<Response>;

export class ProfilePictureValidationError extends Error {
	override name = "ProfilePictureValidationError";
}

export function isHttpImageUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			IMAGE_URL_PATH_PATTERN.test(url.pathname)
		);
	} catch {
		return false;
	}
}

export function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function isValidImageMimeType(contentType: string | null): boolean {
	if (contentType === null) {
		return false;
	}

	const mimeType = contentType.split(";")[0]?.trim().toLowerCase();
	return mimeType !== undefined && VALID_IMAGE_MIME_TYPES.has(mimeType);
}

export async function validateRemoteProfilePictureMime(
	profilePictureUrl: string,
	fetcher: ProfilePictureFetch = fetch,
): Promise<void> {
	if (!isHttpUrl(profilePictureUrl)) {
		return;
	}

	let response: Response;
	try {
		response = await fetcher(profilePictureUrl, { method: "HEAD" });
		if (response.status === 405 || response.status === 501) {
			response = await fetcher(profilePictureUrl, {
				headers: { Range: "bytes=0-0" },
				method: "GET",
			});
		}
	} catch {
		throw new ProfilePictureValidationError(
			"Profile picture URL MIME type could not be validated.",
		);
	}

	if (!response.ok) {
		throw new ProfilePictureValidationError(
			`Profile picture URL returned HTTP ${response.status}.`,
		);
	}

	if (!isValidImageMimeType(response.headers.get("content-type"))) {
		throw new ProfilePictureValidationError(
			"Profile picture URL did not return a valid image MIME type.",
		);
	}
}
