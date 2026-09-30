export const EXTERNAL_API_PROVIDERS = [
	"openai",
	"anthropic",
	"spotify",
	"tiktok",
	"imgur",
	"riot",
	"steam",
] as const;

export type ExternalApiProvider = (typeof EXTERNAL_API_PROVIDERS)[number];

export interface CredentialRejectionReporter {
	recordCredentialRejection(provider: ExternalApiProvider): void;
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const DEFAULT_REJECTED_STATUSES: readonly number[] = [401, 403];

/**
 * Awaits an authenticated HTTP response and records a credential rejection
 * when its status is one the provider uses for refused credentials. The
 * response is returned unchanged so callers keep their own error handling.
 */
export async function reportRejectedResponse(
	reporter: CredentialRejectionReporter | undefined,
	provider: ExternalApiProvider,
	response: Response | Promise<Response>,
	rejectedStatuses: readonly number[] = DEFAULT_REJECTED_STATUSES,
): Promise<Response> {
	const resolved = await response;
	if (rejectedStatuses.includes(resolved.status)) {
		reporter?.recordCredentialRejection(provider);
	}
	return resolved;
}

/**
 * Runs an authenticated operation and records a credential rejection when it
 * throws an error the provider-specific classifier confirms. The original
 * error is always rethrown.
 */
export async function reportRejectedError<T>(
	reporter: CredentialRejectionReporter | undefined,
	provider: ExternalApiProvider,
	operation: () => Promise<T>,
	isRejection: (error: unknown) => boolean,
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (isRejection(error)) {
			reporter?.recordCredentialRejection(provider);
		}
		throw error;
	}
}
