import { DateTime } from "luxon";
import { getEod, getNthWeekdayOfMonth, getZonedDate } from "../helpers/date";
import Holiday from "./Holiday";

type HolidayRange = {
	start: Date;
	end: Date;
};

export interface HolidayRuleContext {
	date: Date;
	timeZone: string;
}

export interface HolidayRuleExample {
	isoDate: string;
}

interface HolidayRuleExamples {
	active: HolidayRuleExample[];
	inactive: HolidayRuleExample[];
}

export interface HolidayRule {
	holiday: Holiday;
	getRange(context: HolidayRuleContext): HolidayRange | null;
	examples: HolidayRuleExamples;
}

export function getContextYear(context: HolidayRuleContext): number {
	return DateTime.fromJSDate(context.date, { zone: context.timeZone }).year;
}

// Defines all holidays to watch the calendar for, and what date ranges should be considered "active" for each
// Smaller index in this list = higher priority, in the case that 2 holidays overlap
// If getRange returns null, then that holiday is inactive for the supplied year
const HOLIDAY_RULES: HolidayRule[] = [
	{
		holiday: Holiday.Xmas,
		getRange: (context) => {
			const year = getContextYear(context);
			return {
				start: getZonedDate(year, context.timeZone, 11).toJSDate(),
				end: getEod(year, context.timeZone, 11, 31),
			};
		},
		examples: {
			active: [{ isoDate: "2024-12-15" }],
			inactive: [{ isoDate: "2024-11-30" }],
		},
	},
	{
		holiday: Holiday.Thanksgiving,
		getRange: (context) => {
			const year = getContextYear(context);
			return {
				start: getNthWeekdayOfMonth(year, context.timeZone, 10, 4, 4), // 4th Thursday of November
				end: getEod(year, context.timeZone, 10, 30),
			};
		},
		examples: {
			active: [{ isoDate: "2024-11-29" }, { isoDate: "2025-11-28" }],
			inactive: [{ isoDate: "2024-11-01" }, { isoDate: "2024-12-01" }],
		},
	},
	{
		holiday: Holiday.USAElection,
		getRange: (context) => {
			const year = getContextYear(context);
			if (year % 4 !== 0) {
				return null;
			}

			return {
				start: getZonedDate(year, context.timeZone, 10).toJSDate(),
				end: getEod(year, context.timeZone, 10, 30),
			};
		},
		examples: {
			active: [{ isoDate: "2024-11-10" }],
			inactive: [{ isoDate: "2025-11-10" }],
		},
	},
	{
		holiday: Holiday.Halloween,
		getRange: (context) => {
			const year = getContextYear(context);
			return {
				start: getZonedDate(year, context.timeZone, 9).toJSDate(),
				end: getEod(year, context.timeZone, 9, 31),
			};
		},
		examples: {
			active: [{ isoDate: "2024-10-15" }],
			inactive: [{ isoDate: "2024-09-30" }],
		},
	},
	{
		holiday: Holiday.IndependenceDay,
		getRange: (context) => {
			const year = getContextYear(context);
			return {
				start: getZonedDate(year, context.timeZone, 6).toJSDate(),
				end: getEod(year, context.timeZone, 6, 31),
			};
		},
		examples: {
			active: [{ isoDate: "2026-07-06" }],
			inactive: [{ isoDate: "2026-06-30" }],
		},
	},
	{
		holiday: Holiday.AprilFools,
		getRange: (context) => {
			const year = getContextYear(context);
			return {
				start: getZonedDate(year, context.timeZone, 3, 1).toJSDate(),
				end: getEod(year, context.timeZone, 3, 1),
			};
		},
		examples: {
			active: [{ isoDate: "2026-04-01" }],
			inactive: [{ isoDate: "2026-04-02" }],
		},
	},
] as const;

export default HOLIDAY_RULES;
