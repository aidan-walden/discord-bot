import { describe, expect, mock, test } from "bun:test";
import {
	isHttpImageUrl,
	isValidImageMimeType,
	ProfilePictureValidationError,
	validateRemoteProfilePictureMime,
} from "./profilePicture";

describe("profile picture helpers", () => {
	test("recognizes direct HTTP image URLs", () => {
		expect(isHttpImageUrl("https://example.com/avatar.png")).toBe(true);
		expect(isHttpImageUrl("http://example.com/avatar.jpeg")).toBe(true);
		expect(isHttpImageUrl("https://example.com/avatar.txt")).toBe(false);
		expect(isHttpImageUrl("ftp://example.com/avatar.png")).toBe(false);
		expect(isHttpImageUrl("not a url")).toBe(false);
	});

	test("accepts supported image MIME types with parameters", () => {
		expect(isValidImageMimeType("image/png")).toBe(true);
		expect(isValidImageMimeType("image/jpeg; charset=binary")).toBe(true);
		expect(isValidImageMimeType("text/html")).toBe(false);
		expect(isValidImageMimeType(null)).toBe(false);
	});

	test("validates remote image MIME with a HEAD request", async () => {
		const fetcher = mock(async () => {
			return new Response(null, {
				headers: { "content-type": "image/webp" },
			});
		});

		await validateRemoteProfilePictureMime(
			"https://example.com/avatar.webp",
			fetcher,
		);

		expect(fetcher).toHaveBeenCalledWith("https://example.com/avatar.webp", {
			method: "HEAD",
		});
	});

	test("falls back to a ranged GET when HEAD is not supported", async () => {
		const fetcher = mock(async (_url: string, init?: RequestInit) => {
			if (init?.method === "HEAD") {
				return new Response(null, { status: 405 });
			}

			return new Response(null, {
				headers: { "content-type": "image/png" },
			});
		});

		await validateRemoteProfilePictureMime(
			"https://example.com/avatar.png",
			fetcher,
		);

		expect(fetcher).toHaveBeenCalledWith("https://example.com/avatar.png", {
			headers: { Range: "bytes=0-0" },
			method: "GET",
		});
	});

	test("rejects non-image MIME types", async () => {
		const fetcher = mock(async () => {
			return new Response(null, {
				headers: { "content-type": "text/plain" },
			});
		});

		await expect(
			validateRemoteProfilePictureMime(
				"https://example.com/avatar.png",
				fetcher,
			),
		).rejects.toBeInstanceOf(ProfilePictureValidationError);
	});

	test("rejects URLs whose MIME type cannot be fetched", async () => {
		const fetcher = mock(async () => {
			throw new Error("network unavailable");
		});

		await expect(
			validateRemoteProfilePictureMime(
				"https://example.com/avatar.png",
				fetcher,
			),
		).rejects.toThrow("Profile picture URL MIME type could not be validated.");
	});
});
