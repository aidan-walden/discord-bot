import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DateTime } from "luxon";
import HolidayProvider from "../services/HolidayProvider";
import Holiday from "./Holiday";
import HOLIDAY_RULES, { type HolidayRuleContext } from "./HolidayRules";

const TEST_TIME_ZONE = "America/New_York";

const EXAMPLES: Record<Holiday, { active: string[]; inactive: string[] }> = {
	[Holiday.Xmas]: {
		active: ["2024-12-15"],
		inactive: ["2024-11-30"],
	},
	[Holiday.Thanksgiving]: {
		active: ["2024-11-29", "2025-11-28"],
		inactive: ["2024-11-01", "2024-12-01"],
	},
	[Holiday.USAElection]: {
		active: ["2024-11-10"],
		inactive: ["2025-11-10"],
	},
	[Holiday.Halloween]: {
		active: ["2024-10-15"],
		inactive: ["2024-09-30"],
	},
	[Holiday.IndependenceDay]: {
		active: ["2026-07-06"],
		inactive: ["2026-06-30"],
	},
	[Holiday.AprilFools]: {
		active: ["2026-04-01"],
		inactive: ["2026-04-02"],
	},
};

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

describe("HolidayRules", () => {
	describe("all holidays have defined test cases", () => {
		for (const rule of HOLIDAY_RULES) {
			describe(rule.holiday, () => {
				test("active and inactive examples are non-empty", () => {
					expect(EXAMPLES[rule.holiday]).not.toBeEmptyObject();
					expect(EXAMPLES[rule.holiday].active.length).toBeGreaterThan(0);
					expect(EXAMPLES[rule.holiday].inactive.length).toBeGreaterThan(0);
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
				for (const isoDate of EXAMPLES[rule.holiday].active) {
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
						expect(provider.getCanonicalHoliday(context)).toBe(
							expectedCanonical,
						);
					});
				}

				for (const isoDate of EXAMPLES[rule.holiday].inactive) {
					test(`treats ${isoDate} as inactive`, () => {
						const context = getExampleContext(isoDate);
						const range = rule.getRange(context);

						if (range !== null) {
							expect(
								context.date < range.start || context.date > range.end,
							).toBe(true);
						}

						const activeHolidays = provider.getAllActiveHolidays(context);
						expect(activeHolidays.has(rule.holiday)).toBe(false);

						const expectedCanonical =
							HOLIDAY_RULES.find(({ holiday }) => activeHolidays.has(holiday))
								?.holiday ?? null;
						expect(provider.getCanonicalHoliday(context)).toBe(
							expectedCanonical,
						);
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
		] as const;

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
});
