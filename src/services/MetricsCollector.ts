import type {
	CredentialRejectionReporter,
	ExternalApiProvider,
} from "./ExternalApiCredentialStatus";

export default class MetricsCollector implements CredentialRejectionReporter {
	private cpuPercent: number = 0;
	private readonly commandCounts = new Map<string, number>();
	private readonly rejectedCredentials = new Set<ExternalApiProvider>();
	private lastCpu: NodeJS.CpuUsage;
	private lastTime: number;

	constructor(intervalMs: number = 5000) {
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

	recordCommand(commandName: string): void {
		this.commandCounts.set(
			commandName,
			(this.commandCounts.get(commandName) ?? 0) + 1,
		);
	}

	get commandExecutions(): ReadonlyMap<string, number> {
		return new Map(this.commandCounts);
	}

	recordCredentialRejection(provider: ExternalApiProvider): void {
		this.rejectedCredentials.add(provider);
	}

	get credentialRejections(): ReadonlySet<ExternalApiProvider> {
		return new Set(this.rejectedCredentials);
	}
}
