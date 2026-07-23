import { describe, expect, test } from "bun:test";
import { createLlmProviders, isCredentialFailure } from "./LlmProvider";

describe("isCredentialFailure", () => {
	const cases: Array<[unknown, boolean]> = [
		[{ status: 401 }, true],
		[{ status: 403 }, false],
		[{ status: 403, type: "permission_error" }, false],
		[{ status: 403, code: "invalid_api_key" }, true],
		[{ status: 403, type: "authentication_error" }, true],
		[{ status: 429, code: "insufficient_quota" }, true],
		[{ status: 429, type: "billing_error" }, true],
		[{ status: 400, type: "billing_error" }, true],
		[{ status: 429, message: "Rate limited" }, false],
		[{ status: 500 }, false],
		[{ message: "no status" }, false],
		["not an object", false],
		[null, false],
	];

	for (const [error, expected] of cases) {
		test(`${JSON.stringify(error)} -> ${expected}`, () => {
			expect(isCredentialFailure(error)).toBe(expected);
		});
	}
});

describe("createLlmProviders", () => {
	test("orders OpenAI before Anthropic when both keys are set", () => {
		const providers = createLlmProviders(
			{ OPENAI_API_TOKEN: "sk-openai", OPENAI_MODEL: "gpt-test" },
			{ ANTHROPIC_API_TOKEN: "sk-anthropic" },
		);

		expect(providers.map((p) => p.name)).toEqual(["openai", "anthropic"]);
	});

	test("skips OpenAI when its model is missing and falls through to Anthropic", () => {
		const providers = createLlmProviders(
			{ OPENAI_API_TOKEN: "sk-openai" },
			{ ANTHROPIC_API_TOKEN: "sk-anthropic" },
		);

		expect(providers.map((p) => p.name)).toEqual(["anthropic"]);
	});

	test("returns Anthropic alone when only its key is set", () => {
		const providers = createLlmProviders(
			{},
			{ ANTHROPIC_API_TOKEN: "sk-anthropic" },
		);

		expect(providers.map((p) => p.name)).toEqual(["anthropic"]);
	});

	test("returns no providers when nothing is configured", () => {
		expect(createLlmProviders({}, {})).toEqual([]);
	});
});
