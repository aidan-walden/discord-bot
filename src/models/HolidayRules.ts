import { getEod, getNthWeekdayOfMonth } from "../helpers/date";
import Holiday from "./Holiday";

interface HolidayRule {
	holiday: Holiday;
	getRange(year: number): {
		start: Date;
		end: Date;
	} | null;
}

// Smaller index in this list = higher priority, in the case that 2 holidays overlap
// If getRange returns null, then that holiday is inactive for the supplied year
const HOLIDAY_RULES: HolidayRule[] = [
	{
		holiday: Holiday.Thanksgiving,
		getRange: (year: number) => ({
			start: getNthWeekdayOfMonth(year, 10, 4, 4), // 4th Thursday of November
			end: getEod(year, 10, 30),
		}),
	},
];

export default HOLIDAY_RULES;
