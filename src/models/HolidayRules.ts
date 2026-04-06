import { getEod, getNthWeekdayOfMonth } from "../helpers/date";
import Holiday from "./Holiday";

interface HolidayRule {
	holiday: Holiday;
	getRange(year: number): {
		start: Date;
		end: Date;
	} | null;
}

// Defines all holidays to watch the calendar for, and what date ranges should be considered "active" for each
// Smaller index in this list = higher priority, in the case that 2 holidays overlap
// If getRange returns null, then that holiday is inactive for the supplied year
const HOLIDAY_RULES: HolidayRule[] = [
	{
		holiday: Holiday.Xmas,
		getRange: (year: number) => ({
			start: new Date(year, 11),
			end: getEod(year, 11, 31),
		}),
	},
	{
		holiday: Holiday.Thanksgiving,
		getRange: (year: number) => ({
			start: getNthWeekdayOfMonth(year, 10, 4, 4), // 4th Thursday of November
			end: getEod(year, 10, 30),
		}),
	},
	{
		holiday: Holiday.USAElection,
		getRange: (year: number) => {
			if (year % 4 !== 0) {
				return null;
			}

			return {
				start: new Date(year, 10),
				end: getEod(year, 10, 30),
			};
		},
	},
	{
		holiday: Holiday.Halloween,
		getRange: (year: number) => ({
			start: new Date(year, 9),
			end: getEod(year, 9, 31),
		}),
	},
	{
		holiday: Holiday.IndependenceDay,
		getRange: (year: number) => ({
			start: new Date(year, 6),
			end: getEod(year, 6, 31),
		}),
	},
	{
		holiday: Holiday.AprilFools,
		getRange: (year: number) => ({
			start: new Date(year, 3, 1),
			end: getEod(year, 3, 1),
		}),
	},
];

export default HOLIDAY_RULES;
