import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DateTime } from "luxon";
import HolidayProvider from "../services/HolidayProvider";
import Holiday from "./Holiday";
import HOLIDAY_RULES, { type HolidayRuleContext } from "./HolidayRules";

const TEST_TIME_ZONE = "America/New_York";

interface OverlapTestCase {
	isoDate: string;
	expectedCanonical: Holiday;
}

function getExampleContext(isoDate: string): HolidayRuleContext {
	return {
		date: DateTime.fromISO(isoDate, { zone: TEST_TIME_ZONE })
			.set({ hour: 12 })
			.toJSDate(),
		timeZone: TEST_TIME_ZONE,
	};
}

describe("all holidays have defined test cases", () => {
	for (const rule of HOLIDAY_RULES) {
		describe(rule.holiday, () => {
			test("active and inactive examples are non-empty", () => {
				expect(rule.examples).not.toBeEmptyObject();
				expect(rule.examples.active.length).toBeGreaterThan(0);
				expect(rule.examples.inactive.length).toBeGreaterThan(0);
			});
		});
	}
});

describe("holiday date mappings", () => {
	let provider: HolidayProvider;

	beforeAll(() => {
		provider = new HolidayProvider();
	});

	afterAll(() => {
		provider.removeAllListeners();
	});

	for (const rule of HOLIDAY_RULES) {
		describe(rule.holiday, () => {
			for (const { isoDate } of rule.examples.active) {
				test(`treats ${isoDate} as active`, () => {
					const context = getExampleContext(isoDate);
					const range = rule.getRange(context);

					expect(range).not.toBeNull();
					if (!range) return;

					expect(context.date >= range.start).toBe(true);
					expect(context.date <= range.end).toBe(true);

					const activeHolidays = provider.getAllActiveHolidays(context);
					expect(activeHolidays.has(rule.holiday)).toBe(true);

					const expectedCanonical =
						HOLIDAY_RULES.find(({ holiday }) => activeHolidays.has(holiday))
							?.holiday ?? null;
					expect(provider.getCanonicalHoliday(context)).toBe(expectedCanonical);
				});
			}

			for (const { isoDate } of rule.examples.inactive) {
				test(`treats ${isoDate} as inactive`, () => {
					const context = getExampleContext(isoDate);
					const range = rule.getRange(context);

					if (range !== null) {
						expect(context.date < range.start || context.date > range.end).toBe(
							true,
						);
					}

					const activeHolidays = provider.getAllActiveHolidays(context);
					expect(activeHolidays.has(rule.holiday)).toBe(false);

					const expectedCanonical =
						HOLIDAY_RULES.find(({ holiday }) => activeHolidays.has(holiday))
							?.holiday ?? null;
					expect(provider.getCanonicalHoliday(context)).toBe(expectedCanonical);
				});
			}
		});
	}
});

describe("holiday overlaps", () => {
	const OVERLAP_TEST_CASES: OverlapTestCase[] = [
		{
			isoDate: "2024-11-29",
			expectedCanonical: Holiday.Thanksgiving,
			// Thanksgiving and USAElection are both active on this date (election year)
			// verifies Thanksgiving takes priority
		},
	];

	let provider: HolidayProvider;

	beforeAll(() => {
		provider = new HolidayProvider();
	});

	afterAll(() => {
		provider.removeAllListeners();
	});

	for (const testcase of OVERLAP_TEST_CASES) {
		test(`canonical holiday for ${testcase.isoDate} is ${testcase.expectedCanonical}`, () => {
			const context = getExampleContext(testcase.isoDate);
			const canonical = provider.getCanonicalHoliday(context);
			expect(canonical).toBe(testcase.expectedCanonical);
		});
	}
});
