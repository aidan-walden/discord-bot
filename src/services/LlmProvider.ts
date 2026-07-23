import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AnthropicConfig, OpenAIConfig } from "../config";
import type { ExternalApiProvider } from "./ExternalApiCredentialStatus";

export type LlmMessage = { role: "user" | "assistant"; content: string };

export interface LlmProvider {
	readonly name: ExternalApiProvider;
	readonly label: string;
	complete(system: string, messages: LlmMessage[]): Promise<string>;
}

const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_MAX_TOKENS = 1024;

class OpenAiProvider implements LlmProvider {
	readonly name = "openai" as const;
	readonly label = "OpenAI";
	private readonly client: OpenAI;

	constructor(
		apiKey: string,
		private readonly model: string,
	) {
		this.client = new OpenAI({ apiKey });
	}

	async complete(system: string, messages: LlmMessage[]): Promise<string> {
		const completion = await this.client.chat.completions.create({
			model: this.model,
			messages: [{ role: "system", content: system }, ...messages],
		});
		return completion.choices[0]?.message.content?.trim() ?? "";
	}
}

class AnthropicProvider implements LlmProvider {
	readonly name = "anthropic" as const;
	readonly label = "Anthropic";
	private readonly client: Anthropic;

	constructor(
		apiKey: string,
		private readonly model: string,
	) {
		this.client = new Anthropic({ apiKey });
	}

	async complete(system: string, messages: LlmMessage[]): Promise<string> {
		const message = await this.client.messages.create({
			model: this.model,
			max_tokens: ANTHROPIC_MAX_TOKENS,
			system,
			messages,
		});
		return message.content
			.filter((block): block is Anthropic.TextBlock => block.type === "text")
			.map((block) => block.text)
			.join("")
			.trim();
	}
}

function readField(error: object, key: string): string {
	const value = (error as Record<string, unknown>)[key];
	return typeof value === "string" ? value : "";
}

/**
 * Whether an error means the provider's credentials are unusable (bad key, no
 * balance) and we should fail over to the next provider rather than surface it.
 *
 * Provider authentication and billing signals trigger failover; permission
 * errors and plain transient rate limits do not.
 */
export function isCredentialFailure(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}

	const status = (error as { status?: unknown }).status;
	const code = readField(error, "code").toLowerCase();
	const type = readField(error, "type").toLowerCase();

	if (
		status === 401 ||
		code === "invalid_api_key" ||
		type === "authentication_error" ||
		type === "billing_error"
	) {
		return true;
	}

	return status === 429 && code === "insufficient_quota";
}

/**
 * Builds the ordered list of usable LLM providers. Preference is OpenAI, then
 * Anthropic; the first with a defined API key is primary and later ones are
 * failover targets. OpenAI needs an explicit model (no sensible default), so an
 * OpenAI key with no OPENAI_MODEL is skipped and we fall through to Anthropic.
 */
export function createLlmProviders(
	openaiConfig: OpenAIConfig,
	anthropicConfig: AnthropicConfig,
): LlmProvider[] {
	const providers: LlmProvider[] = [];

	if (openaiConfig.OPENAI_API_TOKEN && openaiConfig.OPENAI_MODEL) {
		providers.push(
			new OpenAiProvider(
				openaiConfig.OPENAI_API_TOKEN,
				openaiConfig.OPENAI_MODEL,
			),
		);
	}

	if (anthropicConfig.ANTHROPIC_API_TOKEN) {
		providers.push(
			new AnthropicProvider(
				anthropicConfig.ANTHROPIC_API_TOKEN,
				anthropicConfig.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL,
			),
		);
	}

	return providers;
}
