import { describe, expect, test } from "bun:test";
import { DateTime } from "luxon";
import { getEod, getNthWeekdayOfMonth, getZonedDate } from "./date";

const TEST_TIME_ZONE = "America/New_York";

function toZonedDateTime(date: Date) {
	return DateTime.fromJSDate(date, { zone: TEST_TIME_ZONE });
}

describe("date helpers", () => {
	test("getZonedDate() converts zero-based month correctly", () => {
		const result = getZonedDate(2024, TEST_TIME_ZONE, 10, 5);

		expect(result.year).toBe(2024);
		expect(result.month).toBe(11);
		expect(result.day).toBe(5);
		expect(result.hour).toBe(0);
		expect(result.minute).toBe(0);
		expect(result.second).toBe(0);
	});

	test("getZonedDate() defaults day to first of month", () => {
		const result = getZonedDate(2024, TEST_TIME_ZONE, 11);

		expect(result.month).toBe(12);
		expect(result.day).toBe(1);
	});

	test("getNthWeekdayOfMonth() returns correct nth weekday", () => {
		const result = toZonedDateTime(
			getNthWeekdayOfMonth(2024, TEST_TIME_ZONE, 10, 4, 4),
		);

		expect(result.year).toBe(2024);
		expect(result.month).toBe(11);
		expect(result.day).toBe(28);
		expect(result.weekday).toBe(4);
	});

	test("getNthWeekdayOfMonth() normalizes result to start of day", () => {
		const result = toZonedDateTime(
			getNthWeekdayOfMonth(2024, TEST_TIME_ZONE, 10, 4, 4),
		);

		expect(result.hour).toBe(0);
		expect(result.minute).toBe(0);
		expect(result.second).toBe(0);
		expect(result.millisecond).toBe(0);
	});

	test("getNthWeekdayOfMonth() keeps first matching weekday in month", () => {
		const result = toZonedDateTime(
			getNthWeekdayOfMonth(2024, TEST_TIME_ZONE, 0, 1, 1),
		);

		expect(result.year).toBe(2024);
		expect(result.month).toBe(1);
		expect(result.day).toBe(1);
		expect(result.weekday).toBe(1);
	});

	test("getEod() returns end of requested local day", () => {
		const result = toZonedDateTime(getEod(2024, TEST_TIME_ZONE, 10, 30));

		expect(result.year).toBe(2024);
		expect(result.month).toBe(11);
		expect(result.day).toBe(30);
		expect(result.hour).toBe(23);
		expect(result.minute).toBe(59);
		expect(result.second).toBe(59);
		expect(result.millisecond).toBe(999);
	});
});
