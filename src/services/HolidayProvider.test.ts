import { describe, expect, mock, test } from "bun:test";
import { DateTime } from "luxon";
import Holiday from "../models/Holiday";
import type { HolidayRuleContext } from "../models/HolidayRules";
import HolidayProvider, {
	findNextHolidayBoundary,
	type HolidayProviderClock,
	MAX_TIMEOUT,
} from "./HolidayProvider";

const TEST_TIME_ZONE = "America/New_York";

type FakeTimer = {
	id: number;
	delay: number;
	runAt: number;
	callback: () => void;
	cleared: boolean;
	ran: boolean;
};

class FakeClock implements HolidayProviderClock {
	private nextId = 1;
	private readonly timers: FakeTimer[] = [];
	public readonly clearedIds: number[] = [];

	public constructor(private nowMs: number) {}

	public now(): number {
		return this.nowMs;
	}

	public setTimeout(callback: () => void, delay: number): NodeJS.Timeout {
		const timer: FakeTimer = {
			id: this.nextId++,
			delay,
			runAt: this.nowMs + Math.max(delay, 0),
			callback,
			cleared: false,
			ran: false,
		};
		this.timers.push(timer);
		return timer as unknown as NodeJS.Timeout;
	}

	public clearTimeout(timeout: NodeJS.Timeout): void {
		const timer = timeout as unknown as FakeTimer;
		timer.cleared = true;
		this.clearedIds.push(timer.id);
	}

	public getPendingTimers(): FakeTimer[] {
		return this.timers
			.filter((timer) => !timer.cleared && !timer.ran)
			.sort((left, right) => left.runAt - right.runAt);
	}

	public advanceBy(ms: number): void {
		this.advanceTo(this.nowMs + ms);
	}

	private advanceTo(targetMs: number): void {
		while (true) {
			const nextTimer = this.getPendingTimers().find(
				(timer) => timer.runAt <= targetMs,
			);
			if (!nextTimer) {
				break;
			}

			nextTimer.ran = true;
			this.nowMs = nextTimer.runAt;
			nextTimer.callback();
		}

		this.nowMs = targetMs;
	}
}

function toMillis(isoDate: string): number {
	return DateTime.fromISO(isoDate, { zone: TEST_TIME_ZONE }).toMillis();
}

function getContext(isoDate: string): HolidayRuleContext {
	return {
		date: DateTime.fromISO(isoDate, { zone: TEST_TIME_ZONE }).toJSDate(),
		timeZone: TEST_TIME_ZONE,
	};
}

describe("HolidayProvider", () => {
	test("start() emits current holiday immediately and schedules next check", () => {
		const now = toMillis("2024-12-15T12:00:00");
		const clock = new FakeClock(now);
		const provider = new HolidayProvider({
			clock,
			resolveTimeZone: () => TEST_TIME_ZONE,
		});
		const events: Array<Holiday | null> = [];
		const expectedBoundary = findNextHolidayBoundary(
			getContext("2024-12-15T12:00:00"),
		);

		provider.on("change", (holiday: Holiday | null) => {
			events.push(holiday);
		});

		provider.start();

		expect(events).toEqual([Holiday.Xmas]);
		expect(expectedBoundary).not.toBeNull();
		expect(clock.getPendingTimers()).toHaveLength(1);
		expect(clock.getPendingTimers()[0]?.delay).toBe(
			expectedBoundary?.getTime()
				? expectedBoundary.getTime() - now
				: undefined,
		);
	});

	test("start() is idempotent once running", () => {
		const clock = new FakeClock(toMillis("2024-10-15T12:00:00"));
		const provider = new HolidayProvider({
			clock,
			resolveTimeZone: () => TEST_TIME_ZONE,
		});
		const events: Array<Holiday | null> = [];

		provider.on("change", (holiday: Holiday | null) => {
			events.push(holiday);
		});

		provider.start();
		provider.start();

		expect(events).toEqual([Holiday.Halloween]);
		expect(clock.getPendingTimers()).toHaveLength(1);
	});

	test("stop() clears pending timers", () => {
		const clock = new FakeClock(toMillis("2026-01-02T12:00:00"));
		const provider = new HolidayProvider({
			clock,
			resolveTimeZone: () => TEST_TIME_ZONE,
		});

		provider.start();

		const timer = clock.getPendingTimers()[0];
		expect(timer).toBeDefined();
		if (!timer) {
			throw new Error("Expected scheduled timer");
		}

		provider.stop();

		expect(clock.clearedIds).toEqual([timer.id]);
		expect(clock.getPendingTimers()).toHaveLength(0);
	});

	test("findNextHolidayBoundary() picks earliest future boundary", () => {
		const expected = DateTime.fromISO("2024-11-28T00:00:00", {
			zone: TEST_TIME_ZONE,
		}).toJSDate();

		const result = findNextHolidayBoundary(getContext("2024-11-15T12:00:00"));

		expect(result).not.toBeNull();
		expect(result?.getTime()).toBe(expected.getTime());
	});

	test("scheduler chunks waits larger than MAX_TIMEOUT", () => {
		const boundary = DateTime.fromISO("2026-04-01T00:00:00", {
			zone: TEST_TIME_ZONE,
		}).toJSDate();
		const clock = new FakeClock(boundary.getTime() - MAX_TIMEOUT - 250);
		const provider = new HolidayProvider({
			clock,
			resolveTimeZone: () => TEST_TIME_ZONE,
		});
		const events: Array<Holiday | null> = [];

		provider.on("change", (holiday: Holiday | null) => {
			events.push(holiday);
		});

		provider.start();

		expect(events).toEqual([null]);
		expect(clock.getPendingTimers()).toHaveLength(1);
		expect(clock.getPendingTimers()[0]?.delay).toBe(MAX_TIMEOUT);

		clock.advanceBy(MAX_TIMEOUT);

		expect(clock.getPendingTimers()).toHaveLength(1);
		expect(clock.getPendingTimers()[0]?.delay).toBe(250);

		clock.advanceBy(250);

		expect(events).toEqual([null, Holiday.AprilFools]);
	});

	test("scheduler retries after MAX_TIMEOUT when no boundary exists", () => {
		const clock = new FakeClock(toMillis("2026-01-02T12:00:00"));
		const getNextBoundary = mock((_context: HolidayRuleContext) => null);
		const provider = new HolidayProvider({
			clock,
			resolveTimeZone: () => TEST_TIME_ZONE,
			getNextBoundary,
		});
		const events: Array<Holiday | null> = [];

		provider.on("change", (holiday: Holiday | null) => {
			events.push(holiday);
		});

		provider.start();

		expect(events).toEqual([null]);
		expect(getNextBoundary).toHaveBeenCalledTimes(1);
		expect(clock.getPendingTimers()).toHaveLength(1);
		expect(clock.getPendingTimers()[0]?.delay).toBe(MAX_TIMEOUT);

		clock.advanceBy(MAX_TIMEOUT);

		expect(getNextBoundary).toHaveBeenCalledTimes(2);
		expect(clock.getPendingTimers()).toHaveLength(1);
		expect(clock.getPendingTimers()[0]?.delay).toBe(MAX_TIMEOUT);
	});

	test("runtime timezone resolution caches successful lookup", () => {
		const resolveTimeZone = mock(() => TEST_TIME_ZONE);
		const provider = new HolidayProvider({
			clock: new FakeClock(toMillis("2026-01-02T12:00:00")),
			resolveTimeZone,
		});

		provider.getCanonicalHoliday();
		provider.getCanonicalHoliday();

		expect(resolveTimeZone).toHaveBeenCalledTimes(1);
	});

	test("runtime timezone resolution throws when runtime provides no timezone", () => {
		const provider = new HolidayProvider({
			clock: new FakeClock(toMillis("2026-01-02T12:00:00")),
			resolveTimeZone: () => undefined,
		});

		expect(() => provider.getCanonicalHoliday()).toThrow(
			"Unable to resolve runtime timezone",
		);
	});
});
