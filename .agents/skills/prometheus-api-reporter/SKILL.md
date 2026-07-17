---
name: prometheus-api-reporter
description: Wraps external API requests with Prometheus-visible credential rejection reporting while preserving provider behavior. Use when adding or changing authenticated HTTP clients, SDK calls, API-key integrations, OAuth client credentials, or external-service error handling in this Discord bot.
---

# Prometheus API Reporter

## Goal

Every authenticated external request must report a confirmed credential rejection through `CredentialRejectionReporter` without exposing secrets or misclassifying rate limits, timeouts, or provider outages.

The existing Prometheus contract is:

```prometheus
discord_bot_external_api_credentials_configured{provider="provider"} 1
discord_bot_external_api_credentials_rejected{provider="provider"} 0
```

The rejection gauge is sticky for the process lifetime: it changes to `1` after the first confirmed rejection and resets only when the bot restarts.

## Workflow

1. Add a stable lowercase provider name to `EXTERNAL_API_PROVIDERS` in `src/services/ExternalApiCredentialStatus.ts` when the provider is new.
2. Add its configuration-presence check to `src/web/routes/metrics.ts`. Treat paired credentials as configured only when every required value is non-empty after trimming.
3. Inject `CredentialRejectionReporter` into the service or transport wrapper that owns the authenticated request. Wire `bot.metrics` into it from `Bot`.
4. Detect rejection as close to the HTTP response as possible, before an SDK discards status or response details.
5. Call `recordCredentialRejection("provider")`, then preserve existing behavior by rethrowing the original error or returning the same failure result.
6. Add focused provider tests and Prometheus route coverage, then run `bun run test`, `bun run typecheck`, and `bun run check`.

## Classification Rules

- Prefer documented provider error codes or raw HTTP responses.
- Treat `401` as credential rejection. Treat `400` or `403` as rejection only when that provider uses it for invalid credentials and the request context makes the meaning unambiguous.
- Never flag `429`, `5xx`, network failures, timeouts, malformed successful payloads, invalid user input, or insufficient content permissions as rejected credentials.
- If an SDK replaces status with a generic error, inspect its implementation. Add a narrow transport/authentication adapter when needed; do not use broad message matching that turns upstream failures into credential alerts.
- Anonymous services without credentials do not get provider labels.

## Wrapper Pattern

```ts
import type { CredentialRejectionReporter } from "./ExternalApiCredentialStatus";

export class ProviderService {
    constructor(private readonly reporter: CredentialRejectionReporter) {}

    async request(): Promise<Result> {
        const response = await fetchProvider();
        if (response.status === 401) {
            this.reporter.recordCredentialRejection("provider");
        }
        if (!response.ok) {
            throw new ProviderError(response.status);
        }
        return response.json();
    }
}
```

For SDK-thrown errors, use a small provider-specific classifier and test both a credential rejection and a nearby non-authentication failure.

## Security and Metrics Rules

- Never place API keys, tokens, client IDs, secrets, request headers, or provider error bodies in metric names, values, labels, help text, or logs.
- Keep labels bounded to the provider constants; never label by URL, user, guild, raw error, or credential value.
- Keep `credentials_configured` separate from `credentials_rejected`: configured means values are present, while rejected means a request proved they were refused.
- Do not perform probe requests from `/metrics`; scraping must remain local, deterministic, and free of provider side effects.

## Required Tests

- A rejected credential records the correct provider and the original request failure still propagates.
- Rate limiting, server errors, and network failures do not record rejection.
- The Prometheus output includes `0` before rejection and `1` after rejection.
- Responses and logs contain no configured secret values.
- SDK adapters retain token caching/refresh behavior and distinguish authentication rejection from upstream failure.
