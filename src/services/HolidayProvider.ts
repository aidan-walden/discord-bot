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

const MAX_TIMEOUT = 2 ** 31 - 1;

export default class HolidayProvider extends EventEmitter<HolidayProviderEvents> {
	private timeout: NodeJS.Timeout | null = null;
	private isRunning = false;
	private cachedTimeZone: string | null = null;

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
			clearTimeout(this.timeout);
			this.timeout = null;
		}
	}

	private getNextBoundary(context: HolidayRuleContext): Date | null {
		const year = getContextYear(context);
		const candidateYears = [year, year + 1];
		let nextBoundary: Date | null = null;

		for (const candidateYear of candidateYears) {
			for (const { getRange } of HOLIDAY_RULES) {
				const range = getRange(this.getContextForYear(context, candidateYear));
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

	private scheduleNext(): void {
		const context = this.getDefaultContext();
		const next = this.getNextBoundary(context);

		if (next === null) {
			this.scheduleRetry();
			return;
		}

		this.scheduleBoundary(next);
	}

	private scheduleBoundary(boundary: Date): void {
		const remaining = boundary.getTime() - Date.now();
		if (remaining > MAX_TIMEOUT) {
			this.timeout = setTimeout(() => {
				this.scheduleBoundary(boundary);
			}, MAX_TIMEOUT);
			return;
		}

		this.timeout = setTimeout(
			() => {
				this.emit("change", this.getCanonicalHoliday());
				this.scheduleNext();
			},
			Math.max(remaining, 0),
		);
	}

	private scheduleRetry(): void {
		this.timeout = setTimeout(() => {
			if (!this.isRunning) {
				return;
			}

			this.scheduleNext();
		}, MAX_TIMEOUT);
	}

	private getDefaultContext(): HolidayRuleContext {
		return {
			date: new Date(),
			timeZone: this.getDefaultTimeZone(),
		};
	}

	private getDefaultTimeZone(): string {
		if (this.cachedTimeZone !== null) {
			return this.cachedTimeZone;
		}

		const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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
