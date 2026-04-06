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

interface HolidayRule {
	holiday: Holiday;
	getRange(context: HolidayRuleContext): HolidayRange | null;
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
	},
];

export default HOLIDAY_RULES;
