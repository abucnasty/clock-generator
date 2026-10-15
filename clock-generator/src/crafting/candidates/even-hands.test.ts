import { beforeAll, describe, expect, it } from "vitest";
import { loadConfigFromFile } from "../../config/loader";
import { ConfigPaths } from "../../config/config-paths";
import type { Config } from "../../config/schema";
import { quiet } from "../generate-blueprint-test-helpers";
import { planRun } from "../plan/plan-run";
import { evenHandsClock, evenHandsWindows } from "./even-hands";

// The accumulator build of issue 152: two accumulator plants (machines 1 and 2), each fed iron by one caster (3, by
// inserters 3 and 4) and batteries by a battery plant of its own (4 by inserter 6, 5 by inserter 8); the battery
// plants take iron from the same caster (inserters 5 and 7) and copper from one copper caster (9 and 10). Accumulators
// leave on one belt (1 and 2). 640 a second over 18 copies: 576 a period of 972 ticks.
//
// Recorded in Factorio 2.1.21 on its scaffold on 2026-10-14 (settled 7,200 ticks): 576 in each of 46 periods, the
// simulator laid against the game with no difference, at 972 wake-ups a minute (the simulator counts 278 to 941 by
// where the clock starts, 602 from its own start), where the observed windows clock 0.9.1 selected has 2,907.
describe("even hands", () => {
    let config: Config;
    beforeAll(async () => {
        config = await loadConfigFromFile(ConfigPaths.ACCUMULATOR_640);
    });

    it("gives every inserter one window a hand, spread evenly, and the two halves the same windows", () => {
        const plan = planRun({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        const { simulation_context, swing_counts, recipe_lcm, duration } = plan.run;
        expect(duration.ticks).toBe(972);
        const windows = evenHandsWindows(simulation_context.entity_registry, swing_counts, recipe_lcm, duration.ticks);
        const of = (id: number) => windows.get(`inserter:${id}`)!.map(range => [range.start_inclusive, range.end_inclusive]);
        // hands a period: 288 accumulators, 384 iron and 960 batteries into each accumulator plant, 320 iron and 320
        // copper into each battery plant, in hands of 16
        expect([1, 3, 6, 5, 9].map(id => of(id).length)).toEqual([18, 24, 60, 20, 20]);
        // the two halves, and the two takers of a caster at one rate, open and close on the same ticks
        expect(of(2)).toEqual(of(1));
        expect(of(4)).toEqual(of(3));
        expect(of(8)).toEqual(of(6));
        expect(of(7)).toEqual(of(5));
        expect(of(10)).toEqual(of(5));
        // a window a tick shorter than the hand cycle of 8 starts one hand, evenly spaced over the period
        expect(of(3).slice(0, 3)).toEqual([[0, 6], [41, 47], [81, 87]]);
        expect(of(6).every(([start, end]) => end - start + 1 === 7)).toBe(true);
    });

    it("holds the build's 576 a period from every start the clock-only check tries", () => {
        const result = evenHandsClock({ ...config, overrides: { ...config.overrides, derive_clock_windows: false } }, { logger: quiet });
        expect(result.stability_check.as_built?.holds).toBe(true);
        expect(result.stability_check.holds).toBe(true);
        expect(result.stability_check.expected_output_items).toBe(576);
        expect(result.stability_check.as_built?.wake_ups?.wake_ups_per_minute).toBeLessThan(1000);
    });

    it("is not made for a build whose inserters take from a belt", async () => {
        const belt_fed = await loadConfigFromFile(ConfigPaths.AUTOMATION_SCIENCE);
        expect(() => evenHandsClock(belt_fed, { logger: quiet })).toThrow(/every inserter takes from a machine or a chest/);
    });
});
