import { describe, it, expect, beforeAll } from "vitest";
import { generateClockAlternatives, simulateClockOnly, validateConfig, type ClockAlternative, type SerializableClockWindows } from "./generate-blueprint";
import { loadConfigFromFile } from "../config/loader";
import { ConfigPaths } from "../config/config-paths";

describe("generateClockForConfig", () => {

    // The builds are generated in beforeAll hooks, not in the describe bodies: those all run when the file is collected,
    // so a run of one test by name would generate every build in the file first.

    // Two nutrient biochambers [1], [2] feed two pentapod egg biochambers [3], [4], which give each other the egg a
    // craft starts from and send the rest to the science biochamber [5]. Bioflux and nutrients come off one belt on
    // inserters 1, 2 and 11; inserters 3, 4, 6 and 7 bring nutrients to the egg biochambers; 12 takes the science away.
    // The target is 250 a second over 5 modules, 93% of what the egg biochambers can make. Recorded in Factorio 2.1.21
    // for 144000 ticks after 4800 to settle: with 1 output swing per cycle one module made 400 packs in each of 300
    // periods, and so it did with 5 output swings per cycle; with 2 it came up a hand short in 3 of 150 periods and
    // with 4 in 12 of 75 (before the idle-window rules of 2026-10-09; recorded again with them, 2 made the same in each of 75 periods). The simulator has the 5-swing clock hold its
    // rate too. It was the one selected until 2026-10-10, and is again since a trial short only late in its 40 periods runs
    // on: in the simulator it is back from the second period after a loss of nutrients and one to three hands short once,
    // 33 to 37 periods after it, which the game shows too (2026-10-24); from 2026-10-10 the 2-swing clock was selected.
    describe("agricultural science from two pentapod egg biochambers that feed each other", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE_250);
        let alternatives: ClockAlternative[];
        let one_swing: ClockAlternative;
        let windows: SerializableClockWindows;
        let five_swings: ClockAlternative;
        let five_swing_windows: SerializableClockWindows;

        beforeAll(() => {
            ({ alternatives } = generateClockAlternatives(config));
            one_swing = alternatives.find(a => a.label === "1 output swing per cycle")!;
            windows = one_swing.result.clock_windows;
            five_swings = alternatives.find(a => a.id === "planned-belt-slack")!;
            five_swing_windows = five_swings.result.clock_windows;
        });

        // 25 cycles of 115.2 or 57.6 ticks: multiplied in floating point these came out as 2879.9999999999995 and
        // 1439.9999999999998, were taken for fractional periods and offered as subtick and "rounded to 2879" clocks
        it("makes clocks of whole ticks for 6 and 3 output swings per cycle: 2880 and 1440", () => {
            const period = (swings: number) => validateConfig({ ...config, overrides: { ...config.overrides, terminal_swing_count: swings } }).period_ticks;
            expect(period(6)).toBe(2880);
            expect(period(3)).toBe(1440);
            expect(alternatives.find(a => a.label === "6 output swings per cycle")!.result.simulation_duration.ticks).toBe(2880);
            expect(alternatives.find(a => a.label === "3 output swings per cycle")!.result.simulation_duration.ticks).toBe(1440);
            expect(alternatives.filter(a => /subtick|rounded/.test(a.label)).map(a => a.label)).toEqual([]);
        });

        // The values the scaffold recordings expect of this build (no dip and no open issue after its staged start) were seen on
        // one clock: the record's selected clock of this config is checked against the pin in clock-controls.test.ts.

        // The inserters that take out of the egg loop get windows where the science biochamber was under its output block
        // in the clock's long run, and those of the loop take turns after them (agricultural-science-loop-windows.generation.test.ts).
        // The clock holds from every start and gets back from every loss with them, at 2,679 wake-ups a minute counted by the
        // kept lists (the loop's own inserters stay always enabled: their turns do not pass the check).
        it("clocks the inserters that take eggs into the science biochamber on the 5-swing clock, and leaves those of the loop always on", () => {
            const clocked = Object.keys(five_swing_windows).map(id => Number(id.replace("inserter:", ""))).sort((a, b) => a - b);
            expect(clocked).toEqual([1, 2, 3, 4, 6, 7, 9, 10, 11, 12]);
            expect(five_swings.result.loop_windows?.inserter_ids.slice().sort()).toEqual(["inserter:10", "inserter:9"]);
            expect(five_swings.result.loop_windows?.in_loop_ids).toBeUndefined();
            expect(five_swing_windows["inserter:12"].slice(0, 2)).toEqual([{ start: 0, end: 36 }, { start: 96, end: 132 }]);
            expect(five_swings.assessment.wake_ups_per_minute).toBeCloseTo(2679.456, 2);
        });

        it("can be run on its clock alone for a few periods, with what every machine and inserter holds after each tick", () => {
            const stock = simulateClockOnly(config, windows, 480, 3, { log() {}, warn() {}, error() {}, debug() {} });
            expect(stock.ticks).toBeGreaterThanOrEqual(3 * 480);
            const science = stock.machines.find(it => it.recipe === "agricultural-science-pack")!;
            expect(Object.keys(science.inputs).sort()).toEqual(["bioflux", "pentapod-egg"]);
            expect(science.outputs["agricultural-science-pack"]).toHaveLength(stock.ticks);
            expect(science.fuel).toHaveLength(stock.ticks);
            // the output inserter takes a hand of 16 a cycle: 25 hands in each period of 480 ticks
            const held = stock.inserters.find(it => it.inserter_id === "inserter:12")!.held;
            const moved = held.slice(0, 3 * 480).reduce((sum, count, tick) => sum + (tick > 0 && count < held[tick - 1] ? held[tick - 1] - count : 0), 0);
            expect(moved).toBe(3 * 400);
        });
    });
});
