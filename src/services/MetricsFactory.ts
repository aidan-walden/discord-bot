export default class MetricsFactory {
	get memory() {
		const { rss, heapUsed, heapTotal } = process.memoryUsage();
		return { rss, heapUsed, heapTotal };
	}

	get uptime(): number {
		return process.uptime();
	}
}
