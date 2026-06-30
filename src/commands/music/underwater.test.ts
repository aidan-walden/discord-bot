import { describe, expect, mock, spyOn, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import * as musicContext from "../../helpers/musicCommandContext";
import Underwater, { generateBands } from "./underwater";

describe("generateBands", () => {
	test("zeroed produces flat bands from the starting band to 14", () => {
		const bands = generateBands(5, true);
		expect(bands.map((b) => b.band)).toEqual([
			5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
		]);
		expect(bands.every((b) => b.gain === 0)).toBe(true);
	});

	test("ramp produces strictly decreasing gains with a fixed step", () => {
		const bands = generateBands(5, false);
		const step = -0.25 / (15 - 5);
		expect(bands).toHaveLength(10);
		expect(bands[0]?.gain).toBeCloseTo(step, 10);
		expect(bands.at(-1)?.gain).toBeCloseTo(-0.25, 10);
		const gains = bands.map((b) => b.gain);
		for (let i = 1; i < gains.length; i++) {
			const prev = gains[i - 1] ?? 0;
			const cur = gains[i] ?? 0;
			expect(cur).toBeLessThan(prev);
			expect(cur - prev).toBeCloseTo(step, 10);
		}
	});

	test("starting at 0 produces 15 bands", () => {
		const bands = generateBands(0);
		expect(bands).toHaveLength(15);
		expect(bands[0]?.gain).toBeCloseTo(-0.25 / 15, 10);
		expect(bands.at(-1)?.gain).toBeCloseTo(-0.25, 10);
	});
});

describe("Underwater.execute", () => {
	function setup(equalizer: { band: number; gain: number }[] | undefined) {
		const setEqualizer = mock(
			async (_bands: { band: number; gain: number }[]) => undefined,
		);
		const player = { filters: { equalizer }, shoukaku: { setEqualizer } };
		spyOn(musicContext, "getMusicCommandContext").mockResolvedValue({
			player,
		} as unknown as Awaited<
			ReturnType<typeof musicContext.getMusicCommandContext>
		>);
		const reply = mock(async () => undefined);
		const interaction = { reply } as unknown as ChatInputCommandInteraction;
		return { interaction, setEqualizer, reply };
	}

	test("does nothing when there is no player context", async () => {
		spyOn(musicContext, "getMusicCommandContext").mockResolvedValue(null);
		const reply = mock(async () => undefined);
		const interaction = { reply } as unknown as ChatInputCommandInteraction;

		await new Underwater().execute(interaction);

		expect(reply).not.toHaveBeenCalled();
		mock.restore();
	});

	test("enables the effect when currently off", async () => {
		const { interaction, setEqualizer, reply } = setup(undefined);

		await new Underwater().execute(interaction);

		expect(setEqualizer).toHaveBeenCalledTimes(1);
		const bands = setEqualizer.mock.calls[0]?.[0] ?? [];
		expect(bands.some((b) => b.gain < 0)).toBe(true);
		expect(reply).toHaveBeenCalledWith({
			content: "Toggled underwater to **true**",
		});
		mock.restore();
	});

	test("disables the effect when currently on", async () => {
		const { interaction, setEqualizer, reply } = setup([
			{ band: 5, gain: -0.1 },
		]);

		await new Underwater().execute(interaction);

		const bands = setEqualizer.mock.calls[0]?.[0] ?? [];
		expect(bands.every((b) => b.gain === 0)).toBe(true);
		expect(reply).toHaveBeenCalledWith({
			content: "Toggled underwater to **false**",
		});
		mock.restore();
	});
});
