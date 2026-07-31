import { describe, expect, test } from "bun:test";
import MetricsCollector from "./MetricsCollector";

describe("MetricsCollector", () => {
	test("records command executions independently by command name", () => {
		const collector = new MetricsCollector(60_000_000);

		collector.recordCommand("ping");
		collector.recordCommand("play");
		collector.recordCommand("ping");

		expect(collector.commandExecutions).toEqual(
			new Map([
				["ping", 2],
				["play", 1],
			]),
		);
	});

	test("records credential rejections once per provider", () => {
		const collector = new MetricsCollector(60_000_000);

		collector.recordCredentialRejection("openai");
		collector.recordCredentialRejection("openai");
		collector.recordCredentialRejection("spotify");

		expect(collector.credentialRejections).toEqual(
			new Set(["openai", "spotify"]),
		);
	});
});
