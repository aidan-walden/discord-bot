export const EXTERNAL_API_PROVIDERS = [
	"openai",
	"anthropic",
	"spotify",
	"tiktok",
	"imgur",
	"riot",
] as const;

export type ExternalApiProvider = (typeof EXTERNAL_API_PROVIDERS)[number];

export interface CredentialRejectionReporter {
	recordCredentialRejection(provider: ExternalApiProvider): void;
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
