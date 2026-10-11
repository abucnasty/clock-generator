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
    // rate too. It was the one selected until 2026-10-10: in the simulator it does not get back from a loss of nutrients
    // (GOALS.md, "Backpressure Loss"), which the 2-swing and the 1-swing clock do, and the 2-swing clock is selected.
    describe("agricultural science from two pentapod egg biochambers that feed each other", async () => {
        const config = await loadConfigFromFile(ConfigPaths.AGRICULTURAL_SCIENCE);
        let alternatives: ClockAlternative[];
        let selected_index: number;
        let one_swing: ClockAlternative;
        let windows: SerializableClockWindows;
        let five_swings: ClockAlternative;
        let five_swing_windows: SerializableClockWindows;

        beforeAll(() => {
            ({ alternatives, selected_index } = generateClockAlternatives(config));
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

        // Recorded in Factorio 2.1.21 on 2026-10-08: the planned 5-swing clock and the 1-swing clock both hold 250 a
        // second without a miss over 300 periods
        it("holds the target of 250 a second on a clock of 480 ticks, with the planned 5 output swings per cycle", () => {
            expect(five_swings.label).toBe("Batched swings: 5 output swings per cycle");
            expect(five_swings.verdict).not.toBe("unstable");
            expect(five_swings.assessment.items_per_second).toBeCloseTo(250, 6);
            expect(five_swings.result.simulation_duration.ticks).toBe(480);
        });

        it("does not call the 5-swing clock stable: the build does not get back to its rate under it once the nutrients have run out", () => {
            expect(five_swings.assessment.backpressure_loss).toMatchObject({ survives: false, broken_by: ["nutrients stops arriving"] });
            expect(five_swings.verdict).not.toBe("stable");
            expect(five_swings.ranking.meets_target_rate).toBe(false);
        });

        it("selects the 2-swing clock, the one with the fewest wake-ups of the two that get back from every loss", () => {
            const stable = alternatives.filter(a => a.verdict === "stable");
            expect(stable.map(a => a.label).sort()).toEqual(["1 output swing per cycle", "2 output swings per cycle"]);
            expect(alternatives[selected_index].label).toBe("2 output swings per cycle");
            expect(alternatives[selected_index].assessment.wake_ups_per_minute).toBeLessThan(one_swing.assessment.wake_ups_per_minute!);
        });

        it("also holds it with one output swing per cycle", () => {
            expect(one_swing.verdict).toBe("stable");
            expect(one_swing.assessment.items_per_second).toBeCloseTo(250, 6);
        });

        it("leaves the inserters that take eggs from the egg biochambers into the science biochamber always enabled on the 1-swing clock, and clocks the rest", () => {
            const clocked = Object.keys(windows).map(id => Number(id.replace("inserter:", ""))).sort((a, b) => a - b);
            expect(clocked).toEqual([1, 2, 3, 4, 6, 7, 11, 12]);
        });

        it("leaves inserters 9 and 10 always enabled on the 2-swing clock too, where the science biochamber is at its block at the end of most output windows", () => {
            const two_swings = alternatives.find(a => a.label === "2 output swings per cycle")!;
            expect(Object.keys(two_swings.result.clock_windows).sort()).not.toContain("inserter:9");
            expect(Object.keys(two_swings.result.clock_windows).sort()).not.toContain("inserter:10");
        });

        it("clocks the inserters that take eggs into the science biochamber on the 5-swing clock, with a combinator of their own", () => {
            const clocked = Object.keys(five_swing_windows).map(id => Number(id.replace("inserter:", ""))).sort((a, b) => a - b);
            expect(clocked).toEqual([1, 2, 3, 4, 6, 7, 9, 10, 11, 12]);
            expect(five_swing_windows["inserter:10"]).toEqual(five_swing_windows["inserter:9"]);
        });

        // The output of the science biochamber is back at 28 packs up to 30 ticks after an output window ends in the
        // simulator, and 27 to 28 in the game; two ticks more are the margin. Each of the 5 windows of 37 ticks a
        // period of 96 ticks leaves them enabled for 37 + 31 ticks (0 to 67) and disabled for the 28 that follow, until the next opens.
        it("disables inserters 9 and 10 for the 28 ticks before each output window, 32 ticks after the last one closed", () => {
            expect(five_swing_windows["inserter:12"].slice(0, 2)).toEqual([{ start: 0, end: 36 }, { start: 96, end: 132 }]);
            for (const id of ["inserter:9", "inserter:10"]) {
                expect(five_swing_windows[id]).toHaveLength(5);
                expect(five_swing_windows[id].slice(0, 2)).toEqual([{ start: 0, end: 67 }, { start: 96, end: 163 }]);
            }
        });

        it("gives the inserters bringing nutrients to the egg biochambers windows of two hands, 44 hands for the 35 planned a period", () => {
            // 7/5 of a hand an inserter a cycle: 35 hands in 25 cycles, 44 allowed, in 22 windows of 10 ticks
            for (const id of ["inserter:3", "inserter:4", "inserter:6", "inserter:7"]) {
                expect(five_swing_windows[id]).toHaveLength(22);
                expect(five_swing_windows[id].slice(0, 3)).toEqual([{ start: 0, end: 9 }, { start: 21, end: 30 }, { start: 43, end: 52 }]);
                expect(five_swing_windows[id].every(it => it.end - it.start === 9)).toBe(true);
            }
            // all four share one combinator
            expect(new Set(["inserter:3", "inserter:4", "inserter:6", "inserter:7"].map(id => JSON.stringify(five_swing_windows[id]))).size).toBe(1);
        });

        // The machine needs 30.65 hands an inserter in 480 ticks on every clock (the plans round the fuel up to 35 in 480 on
        // the 5- and 1-swing clocks, 65 in 960 on the 2-swing), and 1.43 times that is 44 hands in 480 ticks: 22 windows
        it("gives them 44 windows in 960 ticks on the 2-swing clock, as many for the time as on the others", () => {
            const two_swings = alternatives.find(a => a.label === "2 output swings per cycle")!;
            expect(two_swings.result.clock_windows["inserter:3"]).toHaveLength(44);
            expect(windows["inserter:3"]).toHaveLength(22);
        });

        it("opens the output window at the start of every cycle, for one pickup", () => {
            // 16 packs every 19.2 ticks: 25 hands in a period of 480 ticks
            const output_windows = windows["inserter:12"];
            expect(output_windows).toHaveLength(25);
            expect(output_windows.slice(0, 3)).toEqual([{ start: 0, end: 4 }, { start: 19, end: 23 }, { start: 38, end: 42 }]);
        });

        it("keeps the inserter of the science biochamber enabled: a window as long as a late pickup needs is longer than the cycle", () => {
            expect(windows["inserter:11"]).toEqual([{ start: 0, end: 479 }]);
        });

        it("spreads the hands of the nutrient biochambers evenly over the period, fuel included and rounded up", () => {
            // 400 packs take 160 eggs from 64 crafts: 1920 nutrients and 42 burned, from 98 bioflux: 3.1 hands a machine,
            // and a hand of nutrients every few periods
            for (const id of ["inserter:1", "inserter:2"]) {
                expect(windows[id]).toHaveLength(5);
                expect(windows[id].map(it => it.start)).toEqual([0, 96, 192, 288, 384]);
            }
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

        it("says that the egg recipe loops and that the machines start with eggs inside", () => {
            const insight = one_swing.insights.find(it => it.id === "looping-recipe")!;
            expect(insight.scope).toBe("build");
            expect(insight.what).toContain("starts each of these machines with 7 pentapod-egg already inside");
            expect(insight.table?.rows.map(row => row[0])).toHaveLength(2);
        });
    });
});
