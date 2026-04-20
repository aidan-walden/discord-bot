import { EventEmitter } from "node:events";
import { DateTime } from "luxon";
import type Holiday from "../models/Holiday";
import HOLIDAY_RULES, {
	getContextYear,
	type HolidayRuleContext,
} from "../models/HolidayRules";

interface HolidayProviderEvents {
	change: [holiday: Holiday | null];
}

export const MAX_TIMEOUT = 2 ** 31 - 1;

export interface HolidayProviderClock {
	now(): number;
	setTimeout(callback: () => void, delay: number): NodeJS.Timeout;
	clearTimeout(timeout: NodeJS.Timeout): void;
}

export type HolidayTimeZoneResolver = () => string | null | undefined;
export type HolidayBoundaryFinder = (
	context: HolidayRuleContext,
) => Date | null;

interface HolidayProviderOptions {
	clock?: HolidayProviderClock;
	resolveTimeZone?: HolidayTimeZoneResolver;
	getNextBoundary?: HolidayBoundaryFinder;
}

const SYSTEM_CLOCK: HolidayProviderClock = {
	now: () => Date.now(),
	setTimeout: (callback, delay) => setTimeout(callback, delay),
	clearTimeout: (timeout) => clearTimeout(timeout),
};

function getRuntimeTimeZone(): string | null | undefined {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function findNextHolidayBoundary(
	context: HolidayRuleContext,
	getContextForYear: (
		context: HolidayRuleContext,
		year: number,
	) => HolidayRuleContext = (currentContext, year) => ({
		...currentContext,
		date: DateTime.fromJSDate(currentContext.date, {
			zone: currentContext.timeZone,
		})
			.set({ year })
			.toJSDate(),
	}),
): Date | null {
	const year = getContextYear(context);
	const candidateYears = [year, year + 1];
	let nextBoundary: Date | null = null;

	for (const candidateYear of candidateYears) {
		for (const { getRange } of HOLIDAY_RULES) {
			const range = getRange(getContextForYear(context, candidateYear));
			if (range === null) {
				continue;
			}

			const boundaryCandidates = [
				range.start,
				new Date(range.end.getTime() + 1),
			];
			for (const candidate of boundaryCandidates) {
				if (candidate <= context.date) {
					continue;
				}

				if (nextBoundary === null || candidate < nextBoundary) {
					nextBoundary = candidate;
				}
			}
		}
	}

	return nextBoundary;
}

export default class HolidayProvider extends EventEmitter<HolidayProviderEvents> {
	private timeout: NodeJS.Timeout | null = null;
	private isRunning = false;
	private cachedTimeZone: string | null = null;
	private readonly clock: HolidayProviderClock;
	private readonly resolveTimeZone: HolidayTimeZoneResolver;
	private readonly getNextBoundaryForContext: HolidayBoundaryFinder;

	public constructor(options: HolidayProviderOptions = {}) {
		super();
		this.clock = options.clock ?? SYSTEM_CLOCK;
		this.resolveTimeZone = options.resolveTimeZone ?? getRuntimeTimeZone;
		this.getNextBoundaryForContext =
			options.getNextBoundary ??
			((context) => findNextHolidayBoundary(context, this.getContextForYear));
	}

	public getAllActiveHolidays(
		context: HolidayRuleContext = this.getDefaultContext(),
	): Set<Holiday> {
		return new Set(
			HOLIDAY_RULES.filter(({ getRange }) => {
				const range = getRange(context);
				return (
					range !== null &&
					context.date >= range.start &&
					context.date <= range.end
				);
			}).map(({ holiday }) => holiday),
		);
	}

	public getCanonicalHoliday(
		context: HolidayRuleContext = this.getDefaultContext(),
	): Holiday | null {
		const match = HOLIDAY_RULES.find(({ getRange }) => {
			const range = getRange(context);
			return (
				range !== null &&
				context.date >= range.start &&
				context.date <= range.end
			);
		});
		return match?.holiday ?? null;
	}

	public start(): () => void {
		if (this.isRunning) {
			return () => this.stop();
		}

		this.isRunning = true;
		this.emit("change", this.getCanonicalHoliday());
		this.scheduleNext();

		return () => this.stop();
	}

	public stop(): void {
		this.isRunning = false;

		if (this.timeout !== null) {
			this.clock.clearTimeout(this.timeout);
			this.timeout = null;
		}
	}

	private scheduleNext(): void {
		const context = this.getDefaultContext();
		const next = this.getNextBoundaryForContext(context);

		if (next === null) {
			this.scheduleRetry();
			return;
		}

		this.scheduleBoundary(next);
	}

	private scheduleBoundary(boundary: Date): void {
		const remaining = boundary.getTime() - this.clock.now();
		if (remaining > MAX_TIMEOUT) {
			this.timeout = this.clock.setTimeout(() => {
				this.scheduleBoundary(boundary);
			}, MAX_TIMEOUT);
			return;
		}

		this.timeout = this.clock.setTimeout(
			() => {
				this.emit("change", this.getCanonicalHoliday());
				this.scheduleNext();
			},
			Math.max(remaining, 0),
		);
	}

	private scheduleRetry(): void {
		this.timeout = this.clock.setTimeout(() => {
			if (!this.isRunning) {
				return;
			}

			this.scheduleNext();
		}, MAX_TIMEOUT);
	}

	private getDefaultContext(): HolidayRuleContext {
		return {
			date: new Date(this.clock.now()),
			timeZone: this.getDefaultTimeZone(),
		};
	}

	private getDefaultTimeZone(): string {
		if (this.cachedTimeZone !== null) {
			return this.cachedTimeZone;
		}

		const timeZone = this.resolveTimeZone();
		if (!timeZone) {
			throw new Error("Unable to resolve runtime timezone");
		}

		this.cachedTimeZone = timeZone;
		return timeZone;
	}
	private getContextForYear(
		context: HolidayRuleContext,
		year: number,
	): HolidayRuleContext {
		return {
			...context,
			date: DateTime.fromJSDate(context.date, { zone: context.timeZone })
				.set({ year })
				.toJSDate(),
		};
	}
}
