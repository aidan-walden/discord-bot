import Anthropic from "@anthropic-ai/sdk";
import { TimestampStyles, time } from "discord.js";
import OpenAI from "openai";
import type { AnthropicConfig, OpenAIConfig } from "../config";
import type LlmUserRateLimitRepository from "../repositories/LlmUserRateLimitRepository";
import type { ExternalApiProvider } from "./ExternalApiCredentialStatus";

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequestContext = {
	userId: string;
	requestId: symbol;
};

export interface LlmProvider {
	readonly name: ExternalApiProvider;
	readonly label: string;
	complete(
		request: LlmRequestContext,
		system: string,
		messages: LlmMessage[],
	): Promise<string>;
}

const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
const ANTHROPIC_MAX_TOKENS = 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
/** Ceiling of the Postgres `integer` column overrides are stored in. */
export const MAX_POSTGRES_INTEGER = 2_147_483_647;

type RequestRecord = {
	requestId: symbol;
	timestamp: number;
};

export class LlmUserRateLimitError extends Error {
	/** @param retryAt epoch ms when the oldest request leaves the rolling window */
	constructor(
		readonly limit: number,
		readonly retryAt: number,
	) {
		super(`User has reached the LLM limit of ${limit} requests per hour.`);
		this.name = "LlmUserRateLimitError";
	}
}

export function llmRateLimitNotice(error: LlmUserRateLimitError): string {
	const resumesAt = time(new Date(error.retryAt), TimestampStyles.ShortTime);
	return `You have consumed your usage limit for AI features. Please wait until ${resumesAt} to resume. You get ${error.limit} requests per hour.`;
}

export class LlmUserRateLimiter {
	// ponytail: stale user keys persist until restart; add periodic cleanup if unique-user growth matters.
	private readonly requestsByUserId = new Map<string, RequestRecord[]>();
	// ponytail: single-process cache; needs invalidation via pub/sub if the bot ever runs multi-instance.
	private readonly overrideCache = new Map<string, number | null>();

	constructor(
		private readonly defaultLimit: number,
		private readonly overrides: LlmUserRateLimitRepository,
		private readonly isAdminUser: (userId: string) => boolean,
		private readonly now: () => number = Date.now,
	) {}

	/**
	 * Reserves quota for `request`, runs `call`, and refunds the reservation if
	 * the call fails so provider outages do not burn the user's hourly budget.
	 */
	async withQuota<T>(
		request: LlmRequestContext,
		call: () => Promise<T>,
	): Promise<T> {
		await this.assertAllowed(request);
		try {
			return await call();
		} catch (error) {
			this.release(request);
			throw error;
		}
	}

	async assertAllowed(request: LlmRequestContext): Promise<void> {
		if (this.isAdminUser(request.userId)) {
			return;
		}

		const override = await this.getOverride(request.userId);
		if (override === -1) {
			return;
		}

		// Read-modify-write must stay synchronous after this point, or concurrent
		// requests overwrite each other's records and the limit never fires.
		const previousRequests = this.requestsByUserId.get(request.userId) ?? [];
		if (
			previousRequests.some(({ requestId }) => requestId === request.requestId)
		) {
			return;
		}

		const now = this.now();
		const activeRequests = previousRequests.filter(
			({ timestamp }) => timestamp > now - RATE_LIMIT_WINDOW_MS,
		);
		const limit = override ?? this.defaultLimit;
		if (activeRequests.length >= limit) {
			this.requestsByUserId.set(request.userId, activeRequests);
			const oldest = activeRequests[0]?.timestamp ?? now;
			throw new LlmUserRateLimitError(limit, oldest + RATE_LIMIT_WINDOW_MS);
		}

		activeRequests.push({ requestId: request.requestId, timestamp: now });
		this.requestsByUserId.set(request.userId, activeRequests);
	}

	private release(request: LlmRequestContext): void {
		const records = this.requestsByUserId.get(request.userId);
		if (!records) {
			return;
		}
		this.requestsByUserId.set(
			request.userId,
			records.filter(({ requestId }) => requestId !== request.requestId),
		);
	}

	private async getOverride(userId: string): Promise<number | null> {
		const cached = this.overrideCache.get(userId);
		if (cached !== undefined) {
			return cached;
		}
		const override = await this.overrides.get(userId);
		this.overrideCache.set(userId, override);
		return override;
	}

	async setOverride(userId: string, requestsPerHour: number): Promise<void> {
		if (
			!Number.isSafeInteger(requestsPerHour) ||
			requestsPerHour < -1 ||
			requestsPerHour > MAX_POSTGRES_INTEGER
		) {
			throw new Error(
				`Requests per hour must be from -1 through ${MAX_POSTGRES_INTEGER}.`,
			);
		}
		if (requestsPerHour === 0) {
			await this.overrides.remove(userId);
		} else {
			await this.overrides.set(userId, requestsPerHour);
		}
		this.overrideCache.delete(userId);
	}
}

class OpenAiProvider implements LlmProvider {
	readonly name = "openai" as const;
	readonly label = "OpenAI";
	private readonly client: OpenAI;

	constructor(
		apiKey: string,
		private readonly model: string,
		private readonly rateLimiter: LlmUserRateLimiter,
	) {
		this.client = new OpenAI({ apiKey });
	}

	async complete(
		request: LlmRequestContext,
		system: string,
		messages: LlmMessage[],
	): Promise<string> {
		return this.rateLimiter.withQuota(request, async () => {
			const completion = await this.client.chat.completions.create({
				model: this.model,
				messages: [{ role: "system", content: system }, ...messages],
			});
			return completion.choices[0]?.message.content?.trim() ?? "";
		});
	}
}

class AnthropicProvider implements LlmProvider {
	readonly name = "anthropic" as const;
	readonly label = "Anthropic";
	private readonly client: Anthropic;

	constructor(
		apiKey: string,
		private readonly model: string,
		private readonly rateLimiter: LlmUserRateLimiter,
	) {
		this.client = new Anthropic({ apiKey });
	}

	async complete(
		request: LlmRequestContext,
		system: string,
		messages: LlmMessage[],
	): Promise<string> {
		return this.rateLimiter.withQuota(request, async () => {
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
		});
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
	rateLimiter: LlmUserRateLimiter,
): LlmProvider[] {
	const providers: LlmProvider[] = [];

	if (openaiConfig.OPENAI_API_TOKEN && openaiConfig.OPENAI_MODEL) {
		providers.push(
			new OpenAiProvider(
				openaiConfig.OPENAI_API_TOKEN,
				openaiConfig.OPENAI_MODEL,
				rateLimiter,
			),
		);
	}

	if (anthropicConfig.ANTHROPIC_API_TOKEN) {
		providers.push(
			new AnthropicProvider(
				anthropicConfig.ANTHROPIC_API_TOKEN,
				anthropicConfig.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL,
				rateLimiter,
			),
		);
	}

	return providers;
}
