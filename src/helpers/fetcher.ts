/** Injectable `fetch` signature so HTTP clients can be tested with fakes. */
export type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;
