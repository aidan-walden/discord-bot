import { describe, expect, test } from "bun:test";
import {
	type ExternalApiProvider,
	reportRejectedError,
	reportRejectedResponse,
} from "./ExternalApiCredentialStatus";

function createReporter() {
	const rejected: ExternalApiProvider[] = [];
	return {
		rejected,
		recordCredentialRejection(provider: ExternalApiProvider) {
			rejected.push(provider);
		},
	};
}

describe("reportRejectedResponse", () => {
	test("records 401 and 403 by default and returns the response", async () => {
		for (const status of [401, 403]) {
			const reporter = createReporter();
			const response = new Response(null, { status });
			const result = await reportRejectedResponse(
				reporter,
				"imgur",
				Promise.resolve(response),
			);
			expect(result).toBe(response);
			expect(reporter.rejected).toEqual(["imgur"]);
		}
	});

	test("ignores rate limits, server errors and success", async () => {
		const reporter = createReporter();
		for (const status of [200, 429, 500, 503]) {
			await reportRejectedResponse(
				reporter,
				"steam",
				new Response(null, { status }),
			);
		}
		expect(reporter.rejected).toEqual([]);
	});

	test("honours provider-specific rejected statuses", async () => {
		const reporter = createReporter();
		await reportRejectedResponse(
			reporter,
			"spotify",
			new Response(null, { status: 400 }),
			[400, 401, 403],
		);
		await reportRejectedResponse(
			reporter,
			"riot",
			new Response(null, { status: 400 }),
		);
		expect(reporter.rejected).toEqual(["spotify"]);
	});

	test("propagates network failures without recording", async () => {
		const reporter = createReporter();
		const failure = new Error("network down");
		await expect(
			reportRejectedResponse(reporter, "riot", Promise.reject(failure)),
		).rejects.toBe(failure);
		expect(reporter.rejected).toEqual([]);
	});

	test("tolerates a missing reporter", async () => {
		const response = await reportRejectedResponse(
			undefined,
			"riot",
			new Response(null, { status: 401 }),
		);
		expect(response.status).toBe(401);
	});
});

describe("reportRejectedError", () => {
	const isRejection = (error: unknown) =>
		error instanceof Error && error.message === "bad key";

	test("returns the operation result without recording", async () => {
		const reporter = createReporter();
		const result = await reportRejectedError(
			reporter,
			"openai",
			async () => "ok",
			isRejection,
		);
		expect(result).toBe("ok");
		expect(reporter.rejected).toEqual([]);
	});

	test("records a classified rejection and rethrows the original error", async () => {
		const reporter = createReporter();
		const failure = new Error("bad key");
		await expect(
			reportRejectedError(
				reporter,
				"anthropic",
				async () => {
					throw failure;
				},
				isRejection,
			),
		).rejects.toBe(failure);
		expect(reporter.rejected).toEqual(["anthropic"]);
	});

	test("rethrows unclassified errors without recording", async () => {
		const reporter = createReporter();
		const failure = new Error("upstream timeout");
		await expect(
			reportRejectedError(
				reporter,
				"tiktok",
				async () => {
					throw failure;
				},
				isRejection,
			),
		).rejects.toBe(failure);
		expect(reporter.rejected).toEqual([]);
	});
});
