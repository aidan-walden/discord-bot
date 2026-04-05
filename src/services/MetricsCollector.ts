export default class MetricsCollector {
	private cpuPercent: number = 0;
	private lastCpu: NodeJS.CpuUsage;
	private lastTime: number;
	private readonly startTime: number;

	constructor(intervalMs: number = 5000) {
		this.startTime = performance.now();
		this.lastCpu = process.cpuUsage();
		this.lastTime = performance.now();

		setInterval(() => this.updateCpu(), intervalMs);
	}

	private updateCpu(): void {
		const cpu = process.cpuUsage();
		const elapsed = performance.now() - this.lastTime;

		const userDelta = (cpu.user - this.lastCpu.user) / 1000;
		const sysDelta = (cpu.system - this.lastCpu.system) / 1000;

		this.cpuPercent = ((userDelta + sysDelta) / elapsed) * 100;

		this.lastCpu = cpu;
		this.lastTime = performance.now();
	}

	get cpu(): number {
		return this.cpuPercent;
	}

	get memory() {
		const { rss, heapUsed, heapTotal } = process.memoryUsage();
		return { rss, heapUsed, heapTotal };
	}

	get uptime(): number {
		return process.uptime();
	}
}
