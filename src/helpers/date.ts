import { DateTime } from "luxon";

export function getZonedDate(
	year: number,
	timeZone: string,
	month: number,
	day = 1,
) {
	return DateTime.fromObject(
		{ year, month: month + 1, day },
		{ zone: timeZone },
	);
}

export function getNthWeekdayOfMonth(
	year: number,
	timeZone: string,
	month: number,
	weekday: number,
	n: number,
) {
	const first = getZonedDate(year, timeZone, month, 1);
	const firstWeekday = first.weekday % 7;
	const offset = (weekday - firstWeekday + 7) % 7;

	return first
		.plus({ days: offset + (n - 1) * 7 })
		.startOf("day")
		.toJSDate();
}

export function getEod(
	year: number,
	timeZone: string,
	month: number,
	day: number,
) {
	return getZonedDate(year, timeZone, month, day).endOf("day").toJSDate();
}
