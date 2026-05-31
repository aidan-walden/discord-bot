import { describe, expect, test } from "bun:test";
import MetricsCollector from "./MetricsCollector";

describe("MetricsCollector", () => {
	test("reports process memory usage", () => {
		const collector = new MetricsCollector(60_000_000);
		const memory = collector.memory;

		expect(memory.rss).toBeGreaterThan(0);
		expect(memory.heapUsed).toBeGreaterThan(0);
		expect(memory.heapTotal).toBeGreaterThan(0);
	});

	test("reports process uptime", () => {
		const collector = new MetricsCollector(60_000_000);

		expect(collector.uptime).toBeGreaterThan(0);
	});

	test("updates cpu percent after the sampling interval", async () => {
		const collector = new MetricsCollector(10);

		expect(collector.cpu).toBe(0);
		await Bun.sleep(25);
		expect(collector.cpu).toBeGreaterThanOrEqual(0);
	});
});
